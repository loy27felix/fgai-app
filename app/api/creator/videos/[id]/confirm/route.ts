import { NextResponse } from 'next/server';
import { WetokenVideoError, createWetokenVideoTask, type VideoReference } from '@/lib/ai/video';
import {
  validateCompletedReferencePaths,
  validateStoredVideoDraftRequest,
  type VideoReferenceManifest,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  buildVideoLedgerEntry,
  recordUsageRequired,
  updateVideoUsageBestEffort,
} from '@/lib/usage/ledger';
import { estimateVideoPrice, extractReportedCostUsd } from '@/lib/usage/pricing';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SIGNED_URL_TTL_SECONDS = 3600;

type RouteContext = { params: { id: string } };

const ERRORS = {
  REFERENCES_NOT_READY: '参考素材尚未上传完成',
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
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => supabase.rpc('ensure_creator_workspace'),
    load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { supabase, user, workspace };
}
type CreatorVideoContext = NonNullable<Awaited<ReturnType<typeof creatorContext>>>;

function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || fallback;
}

function providerFailureStatus(error: unknown): 'failed' | 'unknown' {
  return error instanceof WetokenVideoError && !error.retryable ? 'failed' : 'unknown';
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
    sessionResult = await apply(context.supabase);
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
  const result = await context.supabase
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
  const bucket = context.supabase.storage.from('creator-assets');
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
    videoUrl: typeof output.video_url === 'string' ? output.video_url : null,
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
  const bucket = context.supabase.storage.from('creator-assets');
  const references: VideoReference[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const signed = await bucket.createSignedUrl(paths[index], SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error(ERRORS.REFERENCES_NOT_READY);
    const manifest = validated.references[index];
    if (manifest.kind === 'image') {
      references.push({ type: 'image', url: signed.data.signedUrl, role: manifest.role as 'first_frame' | 'last_frame' | 'reference_image' });
    } else if (manifest.kind === 'video') {
      references.push({ type: 'video', url: signed.data.signedUrl, role: 'reference_video' });
    } else {
      references.push({ type: 'audio', url: signed.data.signedUrl, role: 'reference_audio' });
    }
  }
  return references;
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === ERRORS.REFERENCES_NOT_READY) return { message, code: 'REFERENCES_NOT_READY', status: 409 };
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

export async function POST(_req: Request, { params }: RouteContext) {
  let context: Awaited<ReturnType<typeof creatorContext>> = null;
  let claimed: CreatorVideoTask | null = null;
  try {
    context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await ownedTask(context, params.id);
    if (!task) return response(ERRORS.NOT_FOUND, 'VIDEO_TASK_NOT_FOUND', 404);

    const claim = await context.supabase
      .from('creator_generation_tasks')
      .update({ status: 'submitting', confirmed_at: new Date().toISOString(), error: null })
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

    let validated: ReturnType<typeof validateStoredVideoDraftRequest>;
    try {
      validated = validateStoredVideoDraftRequest(claimed.model, claimed.request);
      if (asRecord(claimed.request).uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);
    } catch (error) {
      const normalized = new Error(ERRORS.INVALID_DRAFT);
      await context.supabase.from('creator_generation_tasks').update({ status: 'draft', confirmed_at: null, error: normalized.message }).eq('id', claimed.id).eq('status', 'submitting');
      throw normalized;
    }

    const requestId = 'creator-video:' + claimed.id;
    let references: VideoReference[];
    try {
      // Resolve and sign every reference before writing usage. A missing object
      // must return the draft to the user instead of creating a billed ledger
      // entry for a provider call that never happened.
      references = await buildProviderReferences(context, claimed, validated);
    } catch (error) {
      await context.supabase.from('creator_generation_tasks').update({
        status: 'draft',
        confirmed_at: null,
        error: ERRORS.REFERENCES_NOT_READY,
      }).eq('id', claimed.id).eq('status', 'submitting');
      throw error;
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
        pricing: estimateVideoPrice({ model: claimed.model, duration: validated.duration, resolution: validated.resolution }),
      }));
    } catch (error) {
      console.error('[creator video ledger]', error);
      await context.supabase.from('creator_generation_tasks').update({ status: 'draft', confirmed_at: null, error: ERRORS.USAGE_RECORD_FAILED }).eq('id', claimed.id).eq('status', 'submitting');
      throw new Error(ERRORS.USAGE_RECORD_FAILED);
    }

    {
      let providerTask: Awaited<ReturnType<typeof createWetokenVideoTask>>;
      try {
        providerTask = await createWetokenVideoTask({
          model: claimed.model,
          prompt: validated.effectivePrompt,
          references,
          duration: validated.duration,
          ratio: validated.ratio,
          resolution: validated.resolution,
          watermark: validated.watermark,
          generateAudio: validated.generateAudio,
        });
      } catch (error) {
        const providerStatus = providerFailureStatus(error);
        const completedAt = providerStatus === 'failed' ? new Date().toISOString() : null;
        try {
          await updateOwnedTask(context, claimed.id, {
            status: providerStatus,
            error: safeErrorMessage(error, ERRORS.SUBMIT_FAILED),
            completed_at: completedAt,
          }, 'submitting');
        } catch (persistError) {
          console.error('[creator video provider failure persistence]', persistError);
        }
        await updateVideoUsageBestEffort({ requestId, providerStatus, completedAt });
        throw error;
      }

      const raw = asRecord(providerTask.raw);
      const providerReportedCostUsd = extractReportedCostUsd(providerTask.raw);
      const providerData = asRecord(raw.data);
      const providerNestedTask = asRecord(providerData.task);
      const providerContent = asRecord(raw.content || providerData.content || providerNestedTask.content);
      const output = {
        provider_task_id: providerTask.externalTaskId,
        ...(typeof providerContent.video_url === 'string' ? { video_url: providerContent.video_url } : {}),
      };
      let updated: CreatorVideoTask;
      try {
        updated = await updateOwnedTask(context, claimed.id, {
          external_task_id: providerTask.externalTaskId,
          status: providerTask.status,
          output,
          error: null,
        }, 'submitting');
      } catch (error) {
        console.error('[creator video provider submit]', error);
        try {
          await updateOwnedTask(context, claimed.id, {
            external_task_id: providerTask.externalTaskId,
            output,
            status: 'unknown',
            error: ERRORS.SUBMIT_FAILED,
          }, 'submitting');
        } catch (persistError) {
          console.error('[creator video unknown persistence]', persistError);
        }
        await updateVideoUsageBestEffort({ requestId, providerStatus: 'unknown' });
        throw error;
      }
      await updateVideoUsageBestEffort({ requestId, providerStatus: providerTask.status, reportedCostUsd: providerReportedCostUsd });
      return NextResponse.json({ task: await viewTask(context, updated) });
    }
  } catch (error: unknown) {
    if (context && claimed && error instanceof Error && error.message === ERRORS.SUBMIT_FAILED) {
      const current = await ownedTask(context, claimed.id).catch(() => null);
      if (current) return NextResponse.json({ error: ERRORS.SUBMIT_FAILED, code: 'VIDEO_CONFIRM_UNKNOWN', task: await viewTask(context, current) }, { status: 503 });
    }
    const normalized = publicError(error);
    return response(normalized.message, normalized.code, normalized.status);
  }
}
