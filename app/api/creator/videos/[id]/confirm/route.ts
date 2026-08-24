import { NextResponse } from 'next/server';
import {
  WetokenVideoError,
  WetokenVideoTransportError,
  createWetokenVideoTask,
  type VideoReference,
} from '@/lib/ai/video';
import {
  validateCompletedReferencePaths,
  validateStoredVideoDraftRequest,
  type VideoReferenceManifest,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createAdminClient } from '@/lib/local/admin';
import { createClient } from '@/lib/local/server';
import { readLocalFile } from '@/lib/local/storage';
import {
  buildVideoLedgerEntry,
  recordUsageRequired,
  updateVideoUsageBestEffort,
} from '@/lib/usage/ledger';
import { estimateVideoPrice, extractReportedCostUsd } from '@/lib/usage/pricing';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import { ensureVideoOutputStored, signedVideoOutputUrl } from '@/lib/creator/video-persistence';
import { recordVideoTaskEvent } from '@/lib/creator/video-task-events';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const SIGNED_URL_TTL_SECONDS = 3600;

type RouteContext = { params: { id: string } };

const ERRORS = {
  REFERENCES_NOT_READY: '参考素材尚未上传完成',
  REFERENCES_NOT_REACHABLE: '参考素材当前使用局域网地址，外部视频服务无法访问。请配置可访问的媒体地址，或移除参考素材后重试',
  INVALID_DRAFT: '视频草稿参数无效，已停止确认',
  USAGE_RECORD_FAILED: '视频用量记录写入失败，请稍后重试',
  SUBMIT_FAILED: '视频任务提交失败；状态可能需要对账，请先查看任务历史',
  NOT_FOUND: '视频任务不存在',
} as const;

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeReferences(value: unknown): VideoReferenceManifest[] {
  if (!Array.isArray(value)) throw new Error('invalid reference manifest');
  return value.map((entry) => {
    const reference = asRecord(entry);
    if (
      typeof reference.name !== 'string'
      || typeof reference.mimeType !== 'string'
      || typeof reference.size !== 'number'
      || typeof reference.kind !== 'string'
      || typeof reference.role !== 'string'
    ) throw new Error('invalid reference manifest');
    return {
      name: reference.name,
      mimeType: reference.mimeType,
      size: reference.size,
      kind: reference.kind as VideoReferenceManifest['kind'],
      role: reference.role as VideoReferenceManifest['role'],
    };
  });
}

async function creatorContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc('ensure_creator_workspace'),
    load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { localClient, user, workspace };
}
type CreatorVideoContext = NonNullable<Awaited<ReturnType<typeof creatorContext>>>;

function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:token|key|signature|sig)=)[^&\s]+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || fallback;
}

function providerFailureStatus(error: unknown): 'failed' | 'awaiting_reconciliation' {
  return error instanceof WetokenVideoError && !error.retryable ? 'failed' : 'awaiting_reconciliation';
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

async function assertProviderReferencesReachable(references: VideoReference[]) {
  const unreachable = references.some((reference) => {
    // Image data URLs are intentionally sent inline. This is the LAN-safe
    // path for images because Wetoken cannot fetch the company's NAS address.
    if (reference.type === 'image' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(reference.url)) return false;
    try {
      const url = new URL(reference.url);
      return !['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname);
    } catch {
      return true;
    }
  });
  if (unreachable) throw new Error(ERRORS.REFERENCES_NOT_REACHABLE);

  const remoteReferences = references.filter((reference) => reference.type !== 'image');
  await Promise.all(remoteReferences.map(async (reference) => {
    try {
      // Block only definitive access failures; transient network failures remain advisory.
      // 只阻断明确的鉴权或资源不存在错误，临时网络故障仅告警，避免误伤可用的 Provider 链路。
      const result = await fetch(reference.url, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const status = result.status;
      await result.body?.cancel();
      if ([401, 403, 404].includes(status)) throw new Error(ERRORS.REFERENCES_NOT_REACHABLE);
      if (!result.ok) {
        console.warn('[creator video reference preflight]', {
          type: reference.type,
          role: reference.role,
          outcome: 'advisory_http_failure',
          status,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message === ERRORS.REFERENCES_NOT_REACHABLE) throw error;
      console.warn('[creator video reference preflight]', {
        type: reference.type,
        role: reference.role,
        outcome: 'advisory_transport_failure',
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message.slice(0, 300) : 'transport failure',
      });
    }
  }));
}

function imageDataUrl(mimeType: string, bytes: Buffer) {
  const normalizedMimeType = mimeType.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(normalizedMimeType)) {
    throw new Error(ERRORS.REFERENCES_NOT_READY);
  }
  return `data:${normalizedMimeType};base64,${bytes.toString('base64')}`;
}

async function updateOwnedTask(
  context: CreatorVideoContext,
  taskId: string,
  values: Record<string, unknown>,
  expectedStatus?: string,
) {
  const apply = async (client: any) => {
    let query = client
      .from('creator_generation_tasks')
      .update(values)
      .eq('id', taskId)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'video');
    if (expectedStatus) query = query.eq('status', expectedStatus);
    return query.select('*').maybeSingle();
  };

  let sessionResult: { data?: unknown; error?: unknown } = {};
  try {
    sessionResult = await apply(context.localClient);
    if (!sessionResult.error && sessionResult.data) return sessionResult.data as CreatorVideoTask;
  } catch (error) {
    sessionResult = { error };
  }
  console.error('[creator video task persistence]', {
    taskId,
    path: 'session',
    error: safeErrorMessage(sessionResult.error, 'no row returned'),
  });

  try {
    const adminResult = await apply(createAdminClient());
    if (!adminResult.error && adminResult.data) return adminResult.data as CreatorVideoTask;
    console.error('[creator video task persistence]', {
      taskId,
      path: 'service-role',
      error: safeErrorMessage(adminResult.error, 'no row returned'),
    });
  } catch (error) {
    console.error('[creator video task persistence]', {
      taskId,
      path: 'service-role',
      error: safeErrorMessage(error, 'service role unavailable'),
    });
  }
  throw new Error(ERRORS.SUBMIT_FAILED);
}

async function ownedTask(context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>, taskId: string) {
  const result = await context.localClient
    .from('creator_generation_tasks')
    .select('*')
    .eq('id', taskId)
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as CreatorVideoTask | null;
}

async function viewTask(context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>, task: CreatorVideoTask): Promise<CreatorVideoTaskView> {
  const request = asRecord(task.request);
  const bucket = context.localClient.storage.from('creator-assets');
  let paths: string[] = [];
  try {
    const manifest = normalizeReferences(request.reference_manifest);
    const raw = validateCompletedReferencePaths(request.reference_paths, manifest, task.user_id, task.id);
    paths = raw;
  } catch { paths = []; }
  const referenceUrls = (await Promise.all(paths.map(async (path) => {
    const signed = await bucket.createSignedUrl(path, 300);
    return signed.error ? null : signed.data.signedUrl;
  }))).filter((url): url is string => typeof url === 'string');
  const output = asRecord(task.output);
  return {
    ...task,
    videoUrl: await signedVideoOutputUrl(context, output, 300),
    referenceUrls,
  };
}

async function buildProviderReferences(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: CreatorVideoTask,
  validated: ReturnType<typeof validateStoredVideoDraftRequest>,
): Promise<VideoReference[]> {
  const request = asRecord(task.request);
  if (request.uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);
  const paths = validateCompletedReferencePaths(request.reference_paths, validated.references, task.user_id, task.id);
  const bucket = context.localClient.storage.from('creator-assets');
  const references: VideoReference[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const manifest = validated.references[index];
    if (manifest.kind === 'image') {
      // Do not expose a local NAS URL to Wetoken: it is unreachable from the
      // public provider and produces "resource download failed" after billing.
      // Reference images are capped at 7 MB, so a data URL is a safe transport.
      const bytes = await readLocalFile('creator-assets', paths[index]);
      references.push({
        type: 'image',
        url: imageDataUrl(manifest.mimeType, bytes),
        role: manifest.role as 'first_frame' | 'last_frame' | 'reference_image',
      });
    } else if (manifest.kind === 'video') {
      const signed = await bucket.createProviderSignedUrl(paths[index], SIGNED_URL_TTL_SECONDS);
      if (signed.error || !signed.data?.signedUrl) throw new Error(ERRORS.REFERENCES_NOT_READY);
      references.push({ type: 'video', url: signed.data.signedUrl, role: 'reference_video' });
    } else {
      const signed = await bucket.createProviderSignedUrl(paths[index], SIGNED_URL_TTL_SECONDS);
      if (signed.error || !signed.data?.signedUrl) throw new Error(ERRORS.REFERENCES_NOT_READY);
      references.push({ type: 'audio', url: signed.data.signedUrl, role: 'reference_audio' });
    }
  }
  // External providers cannot download LAN URLs or authenticated local API URLs.
  // 外部 provider 无法访问局域网地址或依赖登录态的本地媒体接口，必须在计费前阻断。
  await assertProviderReferencesReachable(references);
  return references;
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === ERRORS.REFERENCES_NOT_READY) return { message, code: 'REFERENCES_NOT_READY', status: 409 };
  if (message === ERRORS.REFERENCES_NOT_REACHABLE) return { message, code: 'REFERENCES_NOT_REACHABLE', status: 409 };
  if (message === ERRORS.INVALID_DRAFT) return { message, code: 'INVALID_DRAFT', status: 409 };
  if (message === ERRORS.USAGE_RECORD_FAILED) return { message, code: 'USAGE_RECORD_FAILED', status: 409 };
  if (error instanceof WetokenVideoError) {
    const rejected = !error.retryable;
    return {
      message: `Wetoken: ${safeErrorMessage(error, ERRORS.SUBMIT_FAILED)}`,
      code: rejected ? 'VIDEO_PROVIDER_REJECTED' : 'VIDEO_CONFIRM_FAILED',
      status: rejected ? 400 : 502,
    };
  }
  return { message: ERRORS.SUBMIT_FAILED, code: 'VIDEO_CONFIRM_FAILED', status: 502 };
}

/**
 * The local deployment keeps this job in the Node process after the HTTP
 * response is returned.  Seedance 2.5 can take a long time just to hand back
 * an external task ID, so keeping the browser request open makes a live task
 * look like a failed one whenever the client/proxy gives up first.
 */
async function completeProviderSubmission(input: {
  context: CreatorVideoContext;
  task: CreatorVideoTask;
  validated: ReturnType<typeof validateStoredVideoDraftRequest>;
  references: VideoReference[];
  requestId: string;
}) {
  const { context, task, validated, references, requestId } = input;
  let providerTask: Awaited<ReturnType<typeof createWetokenVideoTask>>;
  const submissionStartedAt = new Date().toISOString();
  const providerRequestStartedAt = Date.now();
  try {
    await updateOwnedTask(context, task.id, {
      submission_started_at: submissionStartedAt,
      submission_attempts: 1,
    }, 'submitting');
    await recordVideoTaskEvent(task.id, 'provider_request_started', 'submitting', {
      provider: 'wetoken',
      model: task.model,
      referenceCount: references.length,
    });
    console.info('[creator video provider]', {
      taskId: task.id,
      provider: 'wetoken',
      model: task.model,
      referenceCount: references.length,
      stage: 'submitting',
    });
    providerTask = await createWetokenVideoTask({
      model: task.model,
      prompt: validated.effectivePrompt,
      references,
      duration: validated.duration,
      ratio: validated.ratio,
      resolution: validated.resolution,
      watermark: validated.watermark,
      generateAudio: validated.generateAudio,
    });
  } catch (error) {
    console.error('[creator video provider failure]', {
      taskId: task.id,
      provider: 'wetoken',
      status: error instanceof WetokenVideoError ? error.status : undefined,
      providerCode: error instanceof WetokenVideoError ? error.providerCode : undefined,
      retryable: error instanceof WetokenVideoError ? error.retryable : undefined,
      operation: error instanceof WetokenVideoTransportError ? error.operation : undefined,
      durationMs: error instanceof WetokenVideoTransportError ? error.durationMs : Date.now() - providerRequestStartedAt,
      causeName: error instanceof WetokenVideoTransportError ? error.causeName : undefined,
      causeCode: error instanceof WetokenVideoTransportError ? error.causeCode : undefined,
      message: safeErrorMessage(error, ERRORS.SUBMIT_FAILED),
    });
    const providerStatus = providerFailureStatus(error);
    const reconciliationRequiredAt = providerStatus === 'awaiting_reconciliation' ? new Date().toISOString() : null;
    const completedAt = providerStatus === 'failed' ? new Date().toISOString() : null;
    await recordVideoTaskEvent(task.id, 'provider_request_failed', providerStatus, {
      provider: 'wetoken',
      httpStatus: error instanceof WetokenVideoError ? error.status : undefined,
      providerCode: error instanceof WetokenVideoError ? error.providerCode : undefined,
      retryable: error instanceof WetokenVideoError || error instanceof WetokenVideoTransportError
        ? error.retryable
        : true,
      operation: error instanceof WetokenVideoTransportError ? error.operation : 'submit',
      durationMs: error instanceof WetokenVideoTransportError ? error.durationMs : Date.now() - providerRequestStartedAt,
      causeName: error instanceof WetokenVideoTransportError ? error.causeName : undefined,
      causeCode: error instanceof WetokenVideoTransportError ? error.causeCode : undefined,
    });
    try {
      await updateOwnedTask(context, task.id, {
        status: providerStatus,
        error: safeErrorMessage(error, ERRORS.SUBMIT_FAILED),
        reconciliation_required_at: reconciliationRequiredAt,
        completed_at: completedAt,
      }, 'submitting');
    } catch (persistError) {
      console.error('[creator video provider failure persistence]', persistError);
    }
    const ledgerSettled = await updateVideoUsageBestEffort({ requestId, providerStatus, completedAt });
    await recordVideoTaskEvent(task.id, ledgerSettled ? 'usage_settled' : 'usage_settlement_failed', providerStatus, {
      requestId,
      ledgerStatus: providerStatus === 'failed' ? 'failed' : 'unknown',
    });
    return;
  }

  const raw = asRecord(providerTask.raw);
  const providerReportedCostUsd = extractReportedCostUsd(providerTask.raw);
  const providerData = asRecord(raw.data);
  const providerNestedTask = asRecord(providerData.task);
  const providerContent = asRecord(raw.content || providerData.content || providerNestedTask.content);
  const output: Record<string, unknown> = {
    provider_task_id: providerTask.externalTaskId,
    ...(typeof providerContent.video_url === 'string' ? { video_url: providerContent.video_url } : {}),
  };
  const acknowledgedAt = new Date().toISOString();
  const completedAt = ['succeeded', 'failed', 'expired'].includes(providerTask.status) ? acknowledgedAt : null;
  await recordVideoTaskEvent(task.id, 'provider_task_acknowledged', providerTask.status, {
    provider: 'wetoken',
    externalTaskId: providerTask.externalTaskId,
    durationMs: Date.now() - providerRequestStartedAt,
  });

  let persistedTask: CreatorVideoTask;
  try {
    persistedTask = await updateOwnedTask(context, task.id, {
      external_task_id: providerTask.externalTaskId,
      status: providerTask.status,
      output,
      error: null,
      last_provider_checked_at: acknowledgedAt,
      reconciliation_required_at: null,
      completed_at: completedAt,
    }, 'submitting');
  } catch (error) {
    console.error('[creator video provider submit]', error);
    try {
      await updateOwnedTask(context, task.id, {
        external_task_id: providerTask.externalTaskId,
        output,
        status: 'awaiting_reconciliation',
        error: ERRORS.SUBMIT_FAILED,
        reconciliation_required_at: new Date().toISOString(),
      }, 'submitting');
    } catch (persistError) {
      console.error('[creator video unknown persistence]', persistError);
    }
    await updateVideoUsageBestEffort({ requestId, providerStatus: 'unknown' });
    return;
  }

  const ledgerSettled = await updateVideoUsageBestEffort({
    requestId,
    providerRequestId: providerTask.externalTaskId,
    providerStatus: providerTask.status,
    completedAt,
    reportedCostUsd: providerReportedCostUsd,
  });
  await recordVideoTaskEvent(task.id, ledgerSettled ? 'usage_settled' : 'usage_settlement_failed', providerTask.status, {
    requestId,
    externalTaskId: providerTask.externalTaskId,
  });
  if (providerTask.status === 'succeeded') {
    await ensureVideoOutputStored(context, persistedTask);
  }
}

export async function POST(_req: Request, { params }: RouteContext) {
  let context: Awaited<ReturnType<typeof creatorContext>> = null;
  let claimed: CreatorVideoTask | null = null;
  console.info("[creator video confirm]", { taskId: params.id, stage: "received" });
  try {
    context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await ownedTask(context, params.id);
    if (!task) return response(ERRORS.NOT_FOUND, 'VIDEO_TASK_NOT_FOUND', 404);

    const confirmedAt = new Date().toISOString();
    const claim = await context.localClient
      .from('creator_generation_tasks')
      .update({
        status: 'submitting',
        confirmed_at: confirmedAt,
        submission_started_at: null,
        reconciliation_required_at: null,
        last_provider_checked_at: null,
        submission_attempts: 0,
        error: null,
      })
      .eq('id', task.id)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'video')
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (claim.error) throw claim.error;
    claimed = claim.data as CreatorVideoTask | null;
    if (!claimed) {
      const current = await ownedTask(context, task.id);
      if (!current) return response(ERRORS.NOT_FOUND, 'VIDEO_TASK_NOT_FOUND', 404);
      return NextResponse.json({ duplicate: true, task: await viewTask(context, current) });
    }
    await recordVideoTaskEvent(claimed.id, 'confirmation_claimed', 'submitting', {
      confirmedAt,
    });

    let validated: ReturnType<typeof validateStoredVideoDraftRequest>;
    try {
      validated = validateStoredVideoDraftRequest(claimed.model, claimed.request);
      if (asRecord(claimed.request).uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);
    } catch (error) {
      const normalized = new Error(ERRORS.INVALID_DRAFT);
      await context.localClient.from('creator_generation_tasks').update({ status: 'draft', confirmed_at: null, error: normalized.message }).eq('id', claimed.id).eq('status', 'submitting');
      throw normalized;
    }

    const requestId = 'creator-video:' + claimed.id;
    let references: VideoReference[];
    try {
      // Resolve and sign every reference before writing usage. A missing object
      // must return the draft to the user instead of creating a billed ledger
      // entry for a provider call that never happened.
      references = await buildProviderReferences(context, claimed, validated);
      await recordVideoTaskEvent(claimed.id, 'references_validated', 'submitting', {
        referenceCount: references.length,
      });
      console.info("[creator video confirm]", {
        taskId: claimed.id,
        stage: "references_ready",
        references: references.map((reference) => ({ type: reference.type, role: reference.role })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      const referenceError = errorMessage === ERRORS.REFERENCES_NOT_READY
        || errorMessage === ERRORS.REFERENCES_NOT_REACHABLE
        ? errorMessage
        : ERRORS.REFERENCES_NOT_READY;
      await context.localClient.from('creator_generation_tasks').update({
        status: 'draft',
        confirmed_at: null,
        error: referenceError,
      }).eq('id', claimed.id).eq('status', 'submitting');
      throw error;
    }

const pricing = estimateVideoPrice({ model: claimed.model, duration: validated.duration, resolution: validated.resolution });
    const budget = await assertMonthlyBudgetAvailable({
      userId: context.user.id,
      estimatedCostUsd: pricing?.estimatedCostUsd,
    });
    if (!budget.allowed) {
      await context.localClient.from('creator_generation_tasks').update({
        status: 'draft',
        confirmed_at: null,
        error: budget.message,
      }).eq('id', claimed.id).eq('status', 'submitting');
      return response(budget.message, budget.code, 402);
    }

    try {
      await recordUsageRequired(buildVideoLedgerEntry({
        requestId,
        providerRequestId: claimed.id,
        userId: context.user.id,
        workspaceId: context.workspace.id,
        provider: 'wetoken',
        model: claimed.model,
        duration: validated.duration,
        resolution: validated.resolution,
        generateAudio: validated.generateAudio,
        creatorTaskId: claimed.id,
        pricing,
      }));
      await recordVideoTaskEvent(claimed.id, 'usage_reserved', 'submitting', {
        requestId,
        possiblyCharged: true,
      });
    } catch (error) {
      console.error('[creator video ledger]', error);
      await context.localClient.from('creator_generation_tasks').update({ status: 'draft', confirmed_at: null, error: ERRORS.USAGE_RECORD_FAILED }).eq('id', claimed.id).eq('status', 'submitting');
      throw new Error(ERRORS.USAGE_RECORD_FAILED);
    }

    // Return after durable claim and ledger reservation while Node waits for Wetoken.
    // 持久化任务认领与账本预留后立即返回，由 Node 后台等待 Wetoken 回传任务 ID。
    void completeProviderSubmission({ context, task: claimed, validated, references, requestId })
      .catch((error) => console.error('[creator video background submission]', error));
    return NextResponse.json({ task: await viewTask(context, claimed) }, { status: 202 });
  } catch (error: unknown) {
    console.error("[creator video confirm failure]", {
      taskId: params.id,
      claimed: Boolean(claimed),
      message: safeErrorMessage(error, ERRORS.SUBMIT_FAILED),
    });
    if (context && claimed) {
      const current = await ownedTask(context, claimed.id).catch(() => null);
      if (current && ['unknown', 'awaiting_reconciliation', 'submitting'].includes(current.status)) {
        const currentError = typeof current.error === 'string' && current.error !== ERRORS.SUBMIT_FAILED ? current.error : ERRORS.SUBMIT_FAILED;
        return NextResponse.json({ error: currentError, code: 'VIDEO_CONFIRM_UNKNOWN', task: await viewTask(context, current) }, { status: 503 });
      }
    }
    const normalized = publicError(error);
    return response(normalized.message, normalized.code, normalized.status);
  }
}
