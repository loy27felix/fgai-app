import { NextResponse } from 'next/server';
import {
  WetokenVideoError,
  WetokenVideoTransportError,
  getWetokenVideoTask,
} from '@/lib/ai/video';
import {
  assertOwnedReferencePath,
  referencePathFor,
  validateCompletedReferencePaths,
  validateStoredVideoDraftRequest,
  type VideoReferenceManifest,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { createAdminClient } from '@/lib/local/admin';
import { updateVideoUsageBestEffort } from '@/lib/usage/ledger';
import { extractReportedCostUsd } from '@/lib/usage/pricing';
import { ensureVideoOutputStored, persistVideoOutput, signedVideoOutputUrl } from '@/lib/creator/video-persistence';
import { recordVideoTaskEvent } from '@/lib/creator/video-task-events';
import { markStaleVideoSubmission } from '@/lib/creator/video-task-reconciliation';
import { KnownVideoTaskRecoveryError, reconcileKnownWetokenVideoTask } from '@/lib/creator/video-recovery';

export const runtime = 'nodejs';
export const maxDuration = 120;
const SIGNED_URL_TTL_SECONDS = 300;

type RouteContext = { params: { id: string } };

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(error: unknown, code: string, message: string) {
  console.error('[creator video item]', error);
  return response(message, code, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function loadOwnedTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  id: string,
) {
  // Provider task IDs are never a route identifier. Reconciliation must first
  // prove ownership through this internally-issued UUID.
  if (!isUuid(id)) return null;
  const result = await context.localClient
    .from('creator_generation_tasks')
    .select('*')
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .eq('id', id)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as CreatorVideoTask | null;
}

function referencePathsFor(task: CreatorVideoTask) {
  const request = asRecord(task.request);
  const manifest = normalizeReferences(request.reference_manifest);
  return validateCompletedReferencePaths(request.reference_paths, manifest, task.user_id, task.id);
}

async function taskView(context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>, task: CreatorVideoTask): Promise<CreatorVideoTaskView> {
  const request = asRecord(task.request);
  let paths: string[] = [];
  try { paths = referencePathsFor(task); } catch { paths = []; }
  const referenceUrls = (await Promise.all(paths.map(async (path) => {
    const signed = await context.localClient.storage.from('creator-assets').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    return signed.error ? null : signed.data.signedUrl;
  }))).filter((url): url is string => typeof url === 'string');
  const output = asRecord(task.output);
  return {
    ...task,
    videoUrl: await signedVideoOutputUrl(context, output, SIGNED_URL_TTL_SECONDS),
    referenceUrls,
  };
}

async function assertUploadedObjects(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  paths: string[],
  manifest: VideoReferenceManifest[],
) {
  if (paths.length === 0) return;
  const bucket = context.localClient.storage.from('creator-assets');
  const prefix = paths[0].split('/').slice(0, 4).join('/');
  const listed = await bucket.list(prefix, { limit: 1000 });
  if (listed.error) throw listed.error;
  const expectedNames = new Set(paths.map((path) => path.split('/').pop() || ''));
  const rows = (listed.data || []).filter((entry) => expectedNames.has(entry.name));
  const names = new Set(rows.map((entry) => entry.name));
  if (names.size !== expectedNames.size) throw new Error('reference upload missing');
  rows.forEach((entry) => {
    const metadata = asRecord(entry.metadata);
    const matchingIndex = paths.findIndex((path) => path.endsWith('/' + entry.name));
    const expected = matchingIndex >= 0 ? manifest[matchingIndex] : null;
    const size = typeof metadata.size === 'number' ? metadata.size : null;
    const mime = typeof metadata.mimetype === 'string' ? metadata.mimetype : null;
    if (expected && size !== null && size !== expected.size) throw new Error('reference size mismatch');
    if (expected && mime && mime !== expected.mimeType) throw new Error('reference mime mismatch');
  });
}

function providerErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  const value = asRecord(error);
  return typeof value.message === 'string' ? value.message.slice(0, 500) : '视频状态读取失败';
}

async function pollTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: CreatorVideoTask,
) {
  const currentTask = await markStaleVideoSubmission(task);
  if (!currentTask.external_task_id || ['failed', 'expired'].includes(currentTask.status)) return currentTask;
  // A succeeded task may still only contain a temporary provider URL. Poll
  // Wetoken once more on an explicit task read so a fresh URL can be copied
  // into durable storage after the old URL has expired.
  if (currentTask.status === 'succeeded' && typeof asRecord(currentTask.output).video_storage_path === 'string') return currentTask;
  let polled;
  const pollStartedAt = Date.now();
  try {
    polled = await getWetokenVideoTask(currentTask.external_task_id);
  } catch (error) {
    const checkedAt = new Date().toISOString();
    console.error('[creator video poll]', {
      taskId: currentTask.id,
      externalTaskId: currentTask.external_task_id,
      httpStatus: error instanceof WetokenVideoError ? error.status : undefined,
      providerCode: error instanceof WetokenVideoError ? error.providerCode : undefined,
      operation: error instanceof WetokenVideoTransportError ? error.operation : 'poll',
      durationMs: error instanceof WetokenVideoTransportError ? error.durationMs : Date.now() - pollStartedAt,
      causeName: error instanceof WetokenVideoTransportError ? error.causeName : undefined,
      causeCode: error instanceof WetokenVideoTransportError ? error.causeCode : undefined,
      causeMessage: error instanceof WetokenVideoTransportError ? error.causeMessage : undefined,
      message: providerErrorMessage(error),
    });
    await context.localClient.from('creator_generation_tasks').update({
      last_provider_checked_at: checkedAt,
    }).eq('id', currentTask.id).eq('workspace_id', context.workspace.id).eq('user_id', context.user.id).eq('kind', 'video');
    await recordVideoTaskEvent(currentTask.id, 'provider_poll_failed', currentTask.status, {
      externalTaskId: currentTask.external_task_id,
      httpStatus: error instanceof WetokenVideoError ? error.status : undefined,
      providerCode: error instanceof WetokenVideoError ? error.providerCode : undefined,
      durationMs: error instanceof WetokenVideoTransportError ? error.durationMs : undefined,
      causeName: error instanceof WetokenVideoTransportError ? error.causeName : undefined,
      causeCode: error instanceof WetokenVideoTransportError ? error.causeCode : undefined,
      causeMessage: error instanceof WetokenVideoTransportError ? error.causeMessage : undefined,
    });
    return currentTask;
  }
  const completedAt = ['succeeded', 'failed', 'expired'].includes(polled.status) ? new Date().toISOString() : null;
  const checkedAt = new Date().toISOString();
  const output: Record<string, unknown> = { ...asRecord(currentTask.output), ...(polled.videoUrl ? { video_url: polled.videoUrl } : {}) };
  const update = await context.localClient
    .from('creator_generation_tasks')
    .update({
      status: polled.status,
      output,
      error: polled.error || null,
      completed_at: completedAt,
      last_provider_checked_at: checkedAt,
      reconciliation_required_at: null,
    })
    .eq('id', currentTask.id)
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .select('*')
    .maybeSingle();
  if (update.error || !update.data) return currentTask;
  if (polled.status !== currentTask.status || completedAt) {
    await recordVideoTaskEvent(currentTask.id, 'provider_status_changed', polled.status, {
      externalTaskId: polled.externalTaskId,
      previousStatus: currentTask.status,
      durationMs: Date.now() - pollStartedAt,
    });
  }
  const requestId = 'creator-video:' + currentTask.id;
  const ledgerSettled = await updateVideoUsageBestEffort({
    requestId,
    providerRequestId: polled.externalTaskId,
    providerStatus: polled.status,
    completedAt,
    reportedCostUsd: extractReportedCostUsd(polled.usage),
  });
  if (!ledgerSettled) {
    await recordVideoTaskEvent(currentTask.id, 'usage_settlement_failed', polled.status, {
      requestId,
      externalTaskId: polled.externalTaskId,
    });
  }
  const providerUpdatedTask = update.data as CreatorVideoTask;
  return polled.status === 'succeeded'
    ? ensureVideoOutputStored(context, providerUpdatedTask)
    : providerUpdatedTask;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await loadOwnedTask(context, params.id);
    if (!task) return response('视频任务不存在', 'VIDEO_TASK_NOT_FOUND', 404);
    if (task.status !== 'draft') return response('当前任务已经确认，不能上传参考素材', 'VIDEO_TASK_NOT_DRAFT', 409);
    const form = await req.formData();
    const path = typeof form.get('path') === 'string' ? String(form.get('path')) : '';
    const file = form.get('file');
    if (!(file instanceof File) || !path) return response('参考素材上传参数无效', 'INVALID_UPLOAD', 400);
    const validated = validateStoredVideoDraftRequest(task.model, task.request);
    const manifest = validated.references;
    const expectedPaths = manifest.map((reference, index) => referencePathFor(context.user.id, task.id, index, reference.mimeType));
    const index = expectedPaths.indexOf(path);
    if (index < 0) return response('参考素材上传路径不匹配', 'INVALID_UPLOAD_PATH', 400);
    const expected = manifest[index];
    if (file.type !== expected.mimeType || file.size !== expected.size) return response('参考素材文件与草稿不匹配', 'INVALID_UPLOAD_FILE', 400);
    const body = new Blob([await file.arrayBuffer()], { type: file.type });
    let upload = await context.localClient.storage.from('creator-assets').upload(path, body, { upsert: false, contentType: file.type });
    if (upload.error) {
      try {
        upload = await createAdminClient().storage.from('creator-assets').upload(path, body, { upsert: false, contentType: file.type });
      } catch (error) {
        console.error('[creator video server upload]', error);
      }
    }
    if (upload.error) return response('参考素材上传失败，请稍后重试', 'VIDEO_REFERENCE_UPLOAD_FAILED', 502);
    return NextResponse.json({ ok: true, path });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_REFERENCE_UPLOAD_FAILED', '参考素材上传失败，请稍后重试');
  }
}
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await loadOwnedTask(context, params.id);
    if (!task) return response('视频任务不存在', 'VIDEO_TASK_NOT_FOUND', 404);
    const current = await pollTask(context, task);
    return NextResponse.json({ task: await taskView(context, current) });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_READ_FAILED', '视频任务读取失败，请稍后重试');
  }
}

/**
 * Attach a known Wetoken task to its original local task after an app restart
 * interrupted the background submit/persist flow. This is deliberately scoped
 * to an owned internal UUID: provider task IDs alone cannot expose any media.
 */
export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await loadOwnedTask(context, params.id);
    if (!task) return response('视频任务不存在', 'VIDEO_TASK_NOT_FOUND', 404);
    if (task.status === 'draft') return response('草稿任务尚未提交，不能同步外部视频', 'VIDEO_TASK_NOT_SUBMITTED', 409);
    const body = asRecord(await req.json().catch(() => ({})));
    const externalTaskId = typeof body.externalTaskId === 'string' ? body.externalTaskId : '';
    if (task.external_task_id && task.external_task_id !== externalTaskId.trim()) {
      return response('该本地任务已绑定另一条外部视频任务', 'EXTERNAL_TASK_CONFLICT', 409);
    }

    const recovered = await reconcileKnownWetokenVideoTask({
      task,
      externalTaskId,
      loadProviderTask: getWetokenVideoTask,
      persistOutput: (output) => persistVideoOutput(context, task, output),
      saveTask: async (update) => {
        const saved = await context.localClient
          .from('creator_generation_tasks')
          .update({
            external_task_id: update.externalTaskId,
            status: update.status,
            output: update.output,
            error: null,
            completed_at: update.completedAt,
            last_provider_checked_at: update.completedAt,
            reconciliation_required_at: null,
          })
          .eq('id', task.id)
          .eq('workspace_id', context.workspace.id)
          .eq('user_id', context.user.id)
          .eq('kind', 'video')
          .select('*')
          .maybeSingle();
        if (saved.error) throw saved.error;
        return saved.data ? update : null;
      },
    });
    const savedTask = await loadOwnedTask(context, task.id);
    if (!savedTask) return response('本地视频任务更新失败', 'TASK_UPDATE_FAILED', 500);
    const completedAt = savedTask.completed_at || new Date().toISOString();
    await updateVideoUsageBestEffort({
      requestId: 'creator-video:' + savedTask.id,
      providerRequestId: recovered.provider.externalTaskId,
      providerStatus: 'succeeded',
      completedAt,
      reportedCostUsd: extractReportedCostUsd(recovered.provider.usage),
    });
    const output = asRecord(savedTask.output);
    const durable = typeof output.video_storage_path === 'string';
    await recordVideoTaskEvent(savedTask.id, 'known_provider_task_reconciled', 'succeeded', {
      externalTaskId: recovered.provider.externalTaskId,
      durable,
    });
    return NextResponse.json({
      task: await taskView(context, savedTask),
      durable,
      warning: durable ? null : '已同步到 Wetoken 临时视频地址，但 NAS 归档失败；请在 NAS 恢复后重新同步该任务。',
    });
  } catch (error: unknown) {
    if (error instanceof KnownVideoTaskRecoveryError) {
      const status = error.code === 'INVALID_EXTERNAL_TASK_ID'
        ? 400
        : error.code === 'PROVIDER_TASK_NOT_SUCCEEDED'
          ? 409
          : error.code === 'PROVIDER_VIDEO_URL_MISSING'
            ? 502
            : 500;
      return response(error.message, error.code, status);
    }
    return serverError(error, 'VIDEO_TASK_RECONCILIATION_FAILED', '视频同步失败，请稍后重试');
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await loadOwnedTask(context, params.id);
    if (!task) return response('视频任务不存在', 'VIDEO_TASK_NOT_FOUND', 404);
    if (task.status !== 'draft') return response('当前任务已经确认，不能修改参考素材', 'VIDEO_TASK_NOT_DRAFT', 409);
    const body = asRecord(await req.json().catch(() => ({})));
    const validated = validateStoredVideoDraftRequest(task.model, task.request);
    let paths: string[];
    try {
      paths = validateCompletedReferencePaths(body.referencePaths, validated.references, context.user.id, task.id);
      for (const path of paths) assertOwnedReferencePath(path, context.user.id, task.id);
      await assertUploadedObjects(context, paths, validated.references);
    } catch (error) {
      console.error('[creator video upload validation]', error);
      return response('参考素材上传尚未完成', 'REFERENCES_NOT_READY', 409);
    }
    const request = {
      ...asRecord(task.request),
      reference_paths: paths,
      uploads_complete: true,
    };
    const updated = await context.localClient
      .from('creator_generation_tasks')
      .update({ request })
      .eq('id', task.id)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'video')
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return response('视频草稿已被其他请求修改', 'IDEMPOTENCY_CONFLICT', 409);
    return NextResponse.json({ task: updated.data });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_UPDATE_FAILED', '视频参考素材确认失败，请稍后重试');
  }
}

async function removeTaskFiles(context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>, task: CreatorVideoTask) {
  const request = asRecord(task.request);
  const manifest = normalizeReferences(request.reference_manifest);
  const paths = manifest.map((_, index) => {
    const path = referencePathsFor(task)[index];
    return path;
  }).filter((path): path is string => typeof path === 'string');
  if (paths.length) {
    const removed = await context.localClient.storage.from('creator-assets').remove(paths);
    if (removed.error) throw removed.error;
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const task = await loadOwnedTask(context, params.id);
    if (!task) return response('视频任务不存在', 'VIDEO_TASK_NOT_FOUND', 404);
    try { await removeTaskFiles(context, task); } catch (error) { console.error('[creator video file cleanup]', error); }
    const deleted = await context.localClient
      .from('creator_generation_tasks')
      .delete()
      .eq('id', task.id)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'video')
      .select('id')
      .maybeSingle();
    if (deleted.error) throw deleted.error;
    if (!deleted.data) return response('视频任务未被删除，请刷新后重试', 'VIDEO_TASK_DELETE_MISSING', 409);
    return NextResponse.json({ ok: true, id: deleted.data.id });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_DELETE_FAILED', '视频任务删除失败，请稍后重试');
  }
}
