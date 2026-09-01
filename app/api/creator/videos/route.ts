import { NextResponse } from 'next/server';
import { getVideoModel } from '@/lib/ai/video-models';
import {
  normalizeVideoIdempotencyKey,
  referencePathFor,
  scopedVideoIdempotencyKey,
  validateCompletedReferencePaths,
  validateVideoDraftInput,
  type CreatorVideoSkill,
  type VideoReferenceManifest,
  type VideoReferenceRole,
} from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { ensureVideoOutputStored, signedVideoOutputUrl } from '@/lib/creator/video-persistence';
import { markStaleVideoSubmission } from '@/lib/creator/video-task-reconciliation';

export const runtime = 'nodejs';
const SIGNED_URL_TTL_SECONDS = 300;

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(error: unknown, code: string, message: string) {
  console.error('[creator video collection]', error);
  return response(message, code, 500);
}

function clientValidationMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message.replace(/\s+/g, ' ').trim().slice(0, 300) || '视频任务参数无效';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strictBoolean(value: unknown, fallback: boolean, field: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是 boolean`);
  return value;
}

function strictString(value: unknown, fallback: string, field: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${field} 必须是 string`);
  return value;
}

function strictNumber(value: unknown, fallback: number, field: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${field} 必须是 number`);
  return value;
}

function normalizeSkill(value: unknown): CreatorVideoSkill | null {
  const skill = asRecord(value);
  return typeof skill.name === 'string' && typeof skill.content === 'string'
    ? { name: skill.name, content: skill.content }
    : null;
}

function normalizeReferences(value: unknown): VideoReferenceManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('references must be an array');
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
      role: reference.role as VideoReferenceRole,
    };
  });
}

function taskReferencePaths(task: CreatorVideoTask) {
  const request = asRecord(task.request);
  try {
    const manifest = normalizeReferences(request.reference_manifest);
    return validateCompletedReferencePaths(request.reference_paths, manifest, task.user_id, task.id);
  } catch {
    return [];
  }
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

async function taskViews(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  tasks: CreatorVideoTask[],
) {
  // Repair only a small recent batch per history read so an old provider URL
  // cannot trigger a burst of large downloads. Individual task GETs still
  // repair any older item on demand.
  const repaired = new Map<string, CreatorVideoTask>();
  const repairCandidates = tasks.filter((task) => {
    const output = asRecord(task.output);
    return task.status === 'succeeded' && typeof output.video_storage_path !== 'string' && typeof output.video_url === 'string';
  }).slice(0, 4);
  for (const task of repairCandidates) {
    repaired.set(task.id, await ensureVideoOutputStored(context, task));
  }
  return Promise.all(tasks.map(async (task): Promise<CreatorVideoTaskView> => {
    const durableTask = repaired.get(task.id) || task;
    const referenceUrls = (await Promise.all(taskReferencePaths(durableTask).map(async (path) => {
      const signed = await context.localClient.storage.from('creator-assets').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      return signed.error ? null : signed.data.signedUrl;
    }))).filter((url): url is string => typeof url === 'string');
    const output = asRecord(durableTask.output);
    return {
      ...durableTask,
      videoUrl: await signedVideoOutputUrl(context, output, SIGNED_URL_TTL_SECONDS),
      referenceUrls,
    };
  }));
}

type CreateDraftBody = {
  canvasId?: unknown;
  nodeId?: unknown;
  prompt?: unknown;
  model?: unknown;
  references?: unknown;
  duration?: unknown;
  ratio?: unknown;
  resolution?: unknown;
  watermark?: unknown;
  generateAudio?: unknown;
  idempotencyKey?: unknown;
  skill?: unknown;
};

export async function GET() {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const result = await context.localClient
      .from('creator_generation_tasks')
      .select('*')
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'video')
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    const tasks = await Promise.all(((result.data || []) as CreatorVideoTask[]).map(markStaleVideoSubmission));
    return NextResponse.json({ workspace: context.workspace, tasks: await taskViews(context, tasks) });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_LIST_FAILED', '视频任务加载失败，请稍后重试');
  }
}

export async function POST(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const body = asRecord(await req.json().catch(() => ({})));
    let input: ReturnType<typeof validateVideoDraftInput>;
    let idempotencyKey: string;
    try {
      idempotencyKey = scopedVideoIdempotencyKey(
        context.user.id,
        context.workspace.id,
        normalizeVideoIdempotencyKey(body.idempotencyKey),
      );
      input = validateVideoDraftInput({
        prompt: strictString(body.prompt, '', 'prompt'),
        model: strictString(body.model, 'doubao-seedance-2-0', 'model'),
        references: normalizeReferences(body.references),
        duration: strictNumber(body.duration, 5, 'duration'),
        ratio: strictString(body.ratio, '16:9', 'ratio'),
        resolution: strictString(body.resolution, '720p', 'resolution'),
        watermark: strictBoolean(body.watermark, false, 'watermark'),
        generateAudio: strictBoolean(body.generateAudio, false, 'generateAudio'),
        skill: normalizeSkill(body.skill),
      });
    } catch (error) {
      console.error('[creator video draft validation]', error);
      return response(clientValidationMessage(error), 'INVALID_VIDEO_DRAFT', 400);
    }

    const nodeId = typeof body.nodeId === 'string' && body.nodeId.trim() ? body.nodeId.trim().slice(0, 128) : null;
    const canvasId = typeof body.canvasId === 'string' && body.canvasId.trim() ? body.canvasId.trim() : null;
    if (canvasId) {
      const ownedCanvas = await context.localClient
        .from('creator_canvases')
        .select('id')
        .eq('id', canvasId)
        .eq('workspace_id', context.workspace.id)
        .eq('kind', 'video')
        .maybeSingle();
      if (ownedCanvas.error) throw ownedCanvas.error;
      if (!ownedCanvas.data) return response('视频画布不存在', 'INVALID_CANVAS', 400);
    }

    const model = getVideoModel(input.model);
    const inserted = await context.localClient
      .from('creator_generation_tasks')
      .upsert({
        workspace_id: context.workspace.id,
        user_id: context.user.id,
        kind: 'video',
        canvas_id: canvasId,
        node_id: nodeId,
        provider: 'wetoken',
        model: input.model,
        filter_off: model?.filterOff === true,
        idempotency_key: idempotencyKey,
        status: 'draft',
        request: {
          prompt: input.prompt,
          effective_prompt: input.effectivePrompt,
          skill: input.skill,
          reference_manifest: input.references,
          reference_paths: [],
          uploads_complete: input.references.length === 0,
          duration: input.duration,
          ratio: input.ratio,
          resolution: input.resolution,
          watermark: input.watermark,
          generate_audio: input.generateAudio,
        },
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error;

    let task = inserted.data as CreatorVideoTask | null;
    let replayed = false;
    if (!task) {
      replayed = true;
      const existing = await context.localClient
        .from('creator_generation_tasks')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .eq('workspace_id', context.workspace.id)
        .eq('user_id', context.user.id)
        .eq('kind', 'video')
        .maybeSingle();
      if (existing.error) throw existing.error;
      task = existing.data as CreatorVideoTask | null;
      if (!task) return response('幂等键冲突', 'IDEMPOTENCY_CONFLICT', 409);
    }

    if (task.workspace_id !== context.workspace.id || task.user_id !== context.user.id || task.kind !== 'video') {
      return response('幂等键冲突', 'IDEMPOTENCY_CONFLICT', 409);
    }

    const request = asRecord(task.request);
    const manifest = normalizeReferences(request.reference_manifest);
    const uploadPaths = manifest.map((reference, index) => referencePathFor(context.user.id, task!.id, index, reference.mimeType));
    return NextResponse.json({ task, uploadPaths, replayed }, { status: replayed ? 200 : 201 });
  } catch (error: unknown) {
    return serverError(error, 'VIDEO_TASK_CREATE_FAILED', '视频任务创建失败，请稍后重试');
  }
}
