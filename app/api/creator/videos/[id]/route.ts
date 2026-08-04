import { NextResponse } from 'next/server';
import { getWetokenVideoTask } from '@/lib/ai/video';
import {
  assertOwnedReferencePath,
  referencePathFor,
  validateCompletedReferencePaths,
  validateStoredVideoDraftRequest,
  type VideoReferenceManifest,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { updateVideoUsageBestEffort } from '@/lib/usage/ledger';
import { extractReportedCostUsd } from '@/lib/usage/pricing';
import { ensureVideoOutputStored, persistVideoOutput, signedVideoOutputUrl } from '@/lib/creator/video-persistence';

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

async function loadOwnedTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  id: string,
  allowExternalTaskId = false,
) {
  const baseQuery = () => context.supabase
    .from('creator_generation_tasks')
    .select('*')
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video');

  let result = await baseQuery().eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data && allowExternalTaskId) {
    result = await baseQuery().eq('external_task_id', id).maybeSingle();
    if (result.error) throw result.error;
  }
  return result.data as CreatorVideoTask | null;
}

type LegacyVideoTask = {
  id: string;
  project_id: string;
  shot_id: string | null;
  user_id: string;
  kind: 'video';
  provider: string;
  model: string;
  status: string;
  external_task_id: string;
  request: unknown;
  output: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function creatorTaskStatus(value: string): CreatorVideoTask['status'] {
  return ['draft', 'submitting', 'queued', 'running', 'succeeded', 'failed', 'expired', 'unknown'].includes(value)
    ? value as CreatorVideoTask['status']
    : 'unknown';
}

function legacyOutput(task: LegacyVideoTask): Record<string, unknown> {
  const output = asRecord(task.output);
  const videoUrl = typeof output.video_url === 'string'
    ? output.video_url
    : typeof output.videoUrl === 'string'
      ? output.videoUrl
      : typeof output.result_url === 'string'
        ? output.result_url
        : null;
  return { ...output, ...(videoUrl ? { video_url: videoUrl } : {}) };
}

function legacyAsCreatorTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: LegacyVideoTask,
  output = legacyOutput(task),
  status = creatorTaskStatus(task.status),
): CreatorVideoTask {
  return {
    id: task.id,
    workspace_id: context.workspace.id,
    canvas_id: null,
    node_id: null,
    user_id: task.user_id,
    kind: 'video',
    provider: 'wetoken',
    model: task.model,
    filter_off: false,
    external_task_id: task.external_task_id,
    status,
    idempotency_key: `legacy:${task.id}`,
    request: asRecord(task.request),
    output,
    error: task.error,
    confirmed_at: task.created_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
  };
}

async function loadOwnedLegacyTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  id: string,
) {
  // Legacy `generation_tasks` is protected by the director-project RLS
  // policy (`is_member(project_id)`). A creator canvas task can outlive that
  // membership, so a normal user query can hide a task that still belongs to
  // this user. Use the server-only client for this read fallback while
  // keeping explicit user/kind predicates to prevent cross-account access.
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error('[creator legacy video admin client]', error);
    return null;
  }
  const query = () => admin
    .from('generation_tasks')
    .select('id,project_id,shot_id,user_id,kind,provider,model,status,external_task_id,request,output,error,created_at,updated_at,completed_at')
    .eq('user_id', context.user.id)
    .eq('kind', 'video');
  let result = await query().eq('id', id).maybeSingle();
  if (result.error) {
    console.error('[creator legacy video read by id]', result.error);
    return null;
  }
  if (!result.data) {
    result = await query().eq('external_task_id', id).maybeSingle();
    if (result.error) {
      console.error('[creator legacy video read by external id]', result.error);
      return null;
    }
  }
  return result.data as LegacyVideoTask | null;
}

async function loadOwnedUsageVideoTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  id: string,
) {
  // The usage ledger is intentionally retained even when an old director
  // task row or project is removed. It is a second ownership proof for a
  // Reference ID, not a public task lookup: the service-role query remains
  // restricted to the authenticated user's ledger rows and video kind.
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error('[creator usage video admin client]', error);
    return null;
  }
  const result = await admin
    .from('ai_usage_ledger')
    .select('id,user_id,project_id,provider,model,video_seconds,resolution,status,provider_request_id,created_at,completed_at')
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .eq('provider_request_id', id)
    .maybeSingle();
  if (result.error) {
    console.error('[creator usage video read]', result.error);
    return null;
  }
  const row = result.data;
  if (!row || typeof row.provider_request_id !== 'string') return null;
  return {
    id: 'usage-recovery-' + String(row.id),
    project_id: typeof row.project_id === 'string' ? row.project_id : '',
    shot_id: null,
    user_id: row.user_id,
    kind: 'video',
    provider: typeof row.provider === 'string' ? row.provider : 'wetoken',
    model: typeof row.model === 'string' ? row.model : 'unknown',
    status: row.status === 'failed' ? 'failed' : row.status === 'succeeded' ? 'succeeded' : 'queued',
    external_task_id: row.provider_request_id,
    request: {
      duration: typeof row.video_seconds === 'number' ? row.video_seconds : undefined,
      resolution: typeof row.resolution === 'string' ? row.resolution : undefined,
    },
    output: {},
    error: null,
    created_at: row.created_at,
    updated_at: row.created_at,
    completed_at: row.completed_at,
  } satisfies LegacyVideoTask;
}

async function legacyTaskSnapshot(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: LegacyVideoTask,
) {
  const creatorTask = legacyAsCreatorTask(context, task);
  return {
    ...creatorTask,
    videoUrl: await signedVideoOutputUrl(context, creatorTask.output, SIGNED_URL_TTL_SECONDS),
    referenceUrls: [],
  } satisfies CreatorVideoTaskView;
}

async function recoverLegacyTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: LegacyVideoTask,
) {
  let status = creatorTaskStatus(task.status);
  let output = legacyOutput(task);
  let error = task.error;
  let completedAt = task.completed_at;
  const hasDurableOutput = typeof output.video_storage_path === 'string';

  if (task.external_task_id && !['failed', 'expired'].includes(status) && !hasDurableOutput) {
    try {
      const polled = await getWetokenVideoTask(task.external_task_id);
      status = creatorTaskStatus(polled.status);
      output = { ...output, ...(polled.videoUrl ? { video_url: polled.videoUrl } : {}), ...(polled.usage ? { usage: polled.usage } : {}) };
      error = polled.error || null;
      if (['succeeded', 'failed', 'expired'].includes(status)) completedAt = completedAt || new Date().toISOString();
    } catch (pollError) {
      console.error('[creator legacy video poll]', pollError);
      error = providerErrorMessage(pollError);
    }
  }

  const creatorTask = legacyAsCreatorTask(context, { ...task, error, completed_at: completedAt }, output, status);
  if (status === 'succeeded') output = await persistVideoOutput(context, creatorTask, output);
  let updated = await context.supabase
    .from('generation_tasks')
    .update({ status, output, error, completed_at: completedAt })
    .eq('id', task.id)
    .eq('user_id', context.user.id)
    .select('*')
    .maybeSingle();
  if (updated.error || !updated.data) {
    try {
      updated = await createAdminClient()
        .from('generation_tasks')
        .update({ status, output, error, completed_at: completedAt })
        .eq('id', task.id)
        .eq('user_id', context.user.id)
        .eq('kind', 'video')
        .select('*')
        .maybeSingle();
    } catch (updateError) {
      console.error('[creator legacy video update admin]', updateError);
    }
  }
  if (updated.error) console.error('[creator legacy video update]', updated.error);
  const finalTask = legacyAsCreatorTask(context, { ...task, error, completed_at: completedAt }, output, status);
  if (task.external_task_id) {
    await updateVideoUsageBestEffort({
      requestId: 'wetoken-video:' + task.external_task_id,
      providerStatus: status,
      completedAt,
      reportedCostUsd: extractReportedCostUsd(asRecord(output).usage),
    });
  }
  return {
    ...finalTask,
    videoUrl: await signedVideoOutputUrl(context, output, SIGNED_URL_TTL_SECONDS),
    referenceUrls: [],
  } satisfies CreatorVideoTaskView;
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
    const signed = await context.supabase.storage.from('creator-assets').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
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
  const bucket = context.supabase.storage.from('creator-assets');
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
  const value = asRecord(error);
  return typeof value.message === 'string' ? value.message.slice(0, 500) : '视频状态读取失败';
}

async function pollTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  task: CreatorVideoTask,
) {
  if (!task.external_task_id || ['failed', 'expired'].includes(task.status)) return task;
  // A succeeded task may still only contain a temporary provider URL. Poll
  // Wetoken once more on an explicit task read so a fresh URL can be copied
  // into durable storage after the old URL has expired.
  if (task.status === 'succeeded' && typeof asRecord(task.output).video_storage_path === 'string') return task;
  let polled;
  try {
    polled = await getWetokenVideoTask(task.external_task_id);
  } catch (error) {
    console.error('[creator video poll]', error);
    return task;
  }
  const completedAt = ['succeeded', 'failed', 'expired'].includes(polled.status) ? new Date().toISOString() : null;
  let output: Record<string, unknown> = { ...asRecord(task.output), ...(polled.videoUrl ? { video_url: polled.videoUrl } : {}) };
  if (polled.status === 'succeeded') output = await persistVideoOutput(context, task, output);
  const update = await context.supabase
    .from('creator_generation_tasks')
    .update({
      status: polled.status,
      output,
      error: polled.error || null,
      completed_at: completedAt,
    })
    .eq('id', task.id)
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .select('*')
    .maybeSingle();
  if (update.error || !update.data) return task;
  const requestId = 'creator-video:' + task.id;
  await updateVideoUsageBestEffort({
    requestId,
    providerStatus: polled.status,
    completedAt,
    reportedCostUsd: extractReportedCostUsd(polled.usage),
  });
  return update.data as CreatorVideoTask;
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
    let upload = await context.supabase.storage.from('creator-assets').upload(path, body, { upsert: false, contentType: file.type });
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
    // Accept both the internal cgt-* task ID and Wetoken's
    // external task/reference ID so an old provider task can be recovered.
    const task = await loadOwnedTask(context, params.id, true);
    const legacy = task ? null : await loadOwnedLegacyTask(context, params.id);
    const usageRecovery = task || legacy ? null : await loadOwnedUsageVideoTask(context, params.id);
    if (legacy) return NextResponse.json({ task: await recoverLegacyTask(context, legacy) });
    if (usageRecovery) return NextResponse.json({ task: await recoverLegacyTask(context, usageRecovery) });
    if (!task) return response('未找到该 Reference ID 对应的历史视频任务。请确认 ID 属于当前账号，且 Wetoken 仍保留该任务。', 'VIDEO_TASK_NOT_FOUND', 404);
    const current = await pollTask(context, task);
    return NextResponse.json({ task: await taskView(context, current) });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_READ_FAILED', '视频任务读取失败，请稍后重试');
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
    const updated = await context.supabase
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
    const removed = await context.supabase.storage.from('creator-assets').remove(paths);
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
    const deleted = await context.supabase
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