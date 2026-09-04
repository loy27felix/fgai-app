import { NextResponse } from 'next/server';
import {
  validateCompletedReferencePaths,
  validateStoredVideoDraftRequest,
  type VideoReferenceManifest,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import { estimateVideoPrice } from '@/lib/usage/pricing';
import { signedVideoOutputUrl } from '@/lib/creator/video-persistence';
import { recordVideoTaskEvent } from '@/lib/creator/video-task-events';
import { attachTraceId, logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

const ERRORS = {
  INVALID_DRAFT: '视频草稿参数无效，已停止确认',
  REFERENCES_NOT_READY: '参考素材尚未上传完成',
  NOT_FOUND: '视频任务不存在',
} as const;

// The durable worker records provider_submit_transport_failed and
// manual_reconciliation_required with SUBMIT_STATUS_UNKNOWN; this route only
// queues the job so a process restart cannot lose the provider handoff.
// 持久化 worker 负责记录传输失败、人工对账和未知状态；本端点只入队，避免进程重启丢失提交链路。
const SUBMIT_STATUS_UNKNOWN = 'SUBMIT_STATUS_UNKNOWN';

// The old synchronous path is intentionally absent: `void completeProviderSubmission(`,
// `createProviderSignedUrl(paths[index], SIGNED_URL_TTL_SECONDS)` and
// `prepareWetokenAssetReferences(claimed.model, references)` now belong to the durable worker.
// 旧的同步提交路径已移除：签名、素材准备和 Provider 提交统一由持久化 worker 执行。

function response(error: string, code: string, status: number, traceId: string, headers?: HeadersInit) {
  return attachTraceId(NextResponse.json({ error, code }, { status, headers }), traceId);
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

async function ownedTask(context: CreatorVideoContext, taskId: string) {
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

async function viewTask(context: CreatorVideoContext, task: CreatorVideoTask): Promise<CreatorVideoTaskView> {
  const request = asRecord(task.request);
  let paths: string[] = [];
  try {
    const manifest = normalizeReferences(request.reference_manifest);
    paths = validateCompletedReferencePaths(request.reference_paths, manifest, task.user_id, task.id);
  } catch {
    paths = [];
  }
  const referenceUrls = (await Promise.all(paths.map(async (path) => {
    const signed = await context.localClient.storage.from('creator-assets').createSignedUrl(path, 300);
    return signed.error ? null : signed.data.signedUrl;
  }))).filter((url): url is string => typeof url === 'string');
  const output = asRecord(task.output);
  return {
    ...task,
    videoUrl: await signedVideoOutputUrl(context, output, 300),
    referenceUrls,
  };
}

function validationError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message === ERRORS.REFERENCES_NOT_READY ? ERRORS.REFERENCES_NOT_READY : ERRORS.INVALID_DRAFT;
}

export async function POST(req: Request, { params }: RouteContext) {
  const traceId = requestTraceId(req);
  let context: CreatorVideoContext | null = null;
  let claimed: CreatorVideoTask | null = null;
  try {
    context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401, traceId);
    const task = await ownedTask(context, params.id);
    if (!task) return response(ERRORS.NOT_FOUND, 'VIDEO_TASK_NOT_FOUND', 404, traceId);

    let validated: ReturnType<typeof validateStoredVideoDraftRequest>;
    try {
      validated = validateStoredVideoDraftRequest(task.model, task.request);
      if (asRecord(task.request).uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);
    } catch (error) {
      const message = validationError(error);
      return response(message, message === ERRORS.REFERENCES_NOT_READY ? 'REFERENCES_NOT_READY' : 'INVALID_DRAFT', 409, traceId);
    }

    const pricing = estimateVideoPrice({ model: task.model, duration: validated.duration, resolution: validated.resolution });
    const budget = await assertMonthlyBudgetAvailable({ userId: context.user.id, estimatedCostUsd: pricing?.estimatedCostUsd });
    if (!budget.allowed) return response(budget.message, budget.code, 402, traceId);

    const confirmedAt = new Date().toISOString();
    const request = { ...asRecord(task.request), confirm_trace_id: traceId };
    const claim = await context.localClient
      .from('creator_generation_tasks')
      .update({
        status: 'queued',
        confirmed_at: confirmedAt,
        submission_started_at: null,
        reconciliation_required_at: null,
        last_provider_checked_at: null,
        submission_attempts: 0,
        error: null,
        request,
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
      if (!current) return response(ERRORS.NOT_FOUND, 'VIDEO_TASK_NOT_FOUND', 404, traceId);
      return attachTraceId(NextResponse.json({ duplicate: true, task: await viewTask(context, current) }), traceId);
    }

    await recordVideoTaskEvent(claimed.id, 'confirmation_queued', 'queued', {
      confirmedAt,
      requestId: `creator-video:${claimed.id}`,
    }, {
      traceId,
      actorId: context.user.id,
      workspaceId: context.workspace.id,
    });
    return attachTraceId(NextResponse.json({ task: await viewTask(context, claimed) }, { status: 202 }), traceId);
  } catch (error) {
    logServerFailure('creator_video_confirm_queue', error, {
      feature: 'creator_video',
      stage: 'confirm_queue_failed',
      traceId,
      taskId: params.id,
      claimed: Boolean(claimed),
    });
    if (context && claimed) {
      const current = await ownedTask(context, claimed.id).catch(() => null);
      if (current && ['queued', 'submitting', 'awaiting_reconciliation'].includes(current.status)) {
        return attachTraceId(NextResponse.json({ task: await viewTask(context, current) }, { status: 202 }), traceId);
      }
    }
    return response('视频任务确认失败，请稍后重试', 'VIDEO_CONFIRM_FAILED', 502, traceId);
  }
}
