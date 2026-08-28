import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/local/server';
import {
  buildSeedanceRequest,
  assertSeedanceInputTypes,
  createWetokenVideoTask,
  isDefinitiveWetokenVideoRejection,
  WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS,
  WetokenVideoError,
  WetokenVideoTransportError,
  type SeedanceInput,
  type VideoReference,
} from '@/lib/ai/video';
import {
  isProviderReachableAssetSourceUrl,
  isWetokenAssetUrl,
  WetokenAssetError,
} from '@/lib/ai/wetoken-assets';
import { buildVideoLedgerEntry, recordUsageRequired, updateVideoUsageBestEffort } from '@/lib/usage/ledger';
import { estimateVideoPrice, extractReportedCostUsd } from '@/lib/usage/pricing';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import { canAccessStoragePath } from '@/lib/local/storage-auth';
import { localStorage } from '@/lib/local/storage';

export const runtime = 'nodejs';
export const maxDuration = 1800;

type CreateBody = {
  projectId?: unknown;
  shotId?: unknown;
  model?: unknown;
  prompt?: unknown;
  references?: unknown;
  duration?: unknown;
  ratio?: unknown;
  resolution?: unknown;
  watermark?: unknown;
  generateAudio?: unknown;
};

const PROVIDER_REFERENCE_TTL_SECONDS = 3600;

class VideoReferenceInputError extends Error {
  constructor(message: string, readonly status: 400 | 403 = 400) {
    super(message);
    this.name = 'VideoReferenceInputError';
  }
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

function strictBoolean(value: unknown, fallback: boolean, field: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是 boolean`);
  return value;
}

function strictReferences(value: unknown): VideoReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('references 必须是 array');
  return value as VideoReference[];
}

async function shotBelongsToProject(localClient: ReturnType<typeof createClient>, shotId: string, projectId: string) {
  const { data: shot } = await localClient.from('shots').select('id,scene_id').eq('id', shotId).maybeSingle();
  if (!shot) return false;
  const { data: scene } = await localClient.from('scenes').select('id,episode_id').eq('id', shot.scene_id).maybeSingle();
  if (!scene) return false;
  const { data: episode } = await localClient.from('episodes').select('id,project_id').eq('id', scene.episode_id).maybeSingle();
  return episode?.project_id === projectId;
}

async function providerReference(
  reference: VideoReference,
  userId: string,
  projectId: string,
) {
  // Resolve local project media to a temporary public URL before Wetoken downloads it.
  // 先把项目本地媒体转换为临时公网签名 URL，供 Wetoken 素材库下载；原始 URL 不落库。
  if (!reference || typeof reference.url !== 'string') throw new VideoReferenceInputError('参考素材 URL 格式无效');
  if (isWetokenAssetUrl(reference.url)) {
    throw new VideoReferenceInputError('不能直接使用外部素材 ID，请提交当前项目中的原始素材');
  }
  if (isProviderReachableAssetSourceUrl(reference.url)) return reference;
  let url: URL;
  try {
    url = new URL(reference.url, 'http://local');
  } catch {
    throw new VideoReferenceInputError('参考素材 URL 格式无效');
  }
  if (url.pathname !== '/api/local/storage/content' || url.searchParams.get('bucket') !== 'project-assets') {
    throw new VideoReferenceInputError('参考素材必须先上传到当前项目素材库');
  }
  const path = url.searchParams.get('path') || '';
  if (!path.startsWith(`${projectId}/`) || !await canAccessStoragePath(userId, 'project-assets', path)) {
    throw new VideoReferenceInputError('参考素材不属于当前项目', 403);
  }
  const signed = await localStorage('project-assets').createProviderSignedUrl(path, PROVIDER_REFERENCE_TTL_SECONDS);
  const providerUrl = signed.data?.signedUrl || '';
  if (!isProviderReachableAssetSourceUrl(providerUrl)) {
    throw new Error('参考素材需要配置公网 HTTPS 媒体地址');
  }
  return { ...reference, url: providerUrl };
}

export async function GET(req: Request) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get('projectId') || '';
  if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  const { data: membership } = await localClient.from('project_members')
    .select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '无权访问该项目' }, { status: 403 });
  const staleBefore = new Date(Date.now() - WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS - 60_000).toISOString();
  const staleSubmissions = await localClient.from('generation_tasks').update({
    status: 'unknown',
    error: 'Provider 提交结果未确认，请先在 Wetoken 后台核对，不要立即重试',
  }).eq('project_id', projectId).eq('user_id', user.id).eq('kind', 'video')
    .eq('status', 'submitting').lt('created_at', staleBefore).select('id');
  await Promise.all((staleSubmissions.data || []).map((task: { id: string }) => updateVideoUsageBestEffort({
    requestId: `wetoken-video:${task.id}`,
    providerStatus: 'unknown',
  })));
  const { data, error } = await localClient.from('generation_tasks')
    .select('id,project_id,shot_id,user_id,kind,provider,model,external_task_id,status,request,output,error,created_at,updated_at,completed_at')
    .eq('project_id', projectId).eq('kind', 'video').order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: `读取视频任务失败：${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, tasks: data || [] });
}

export async function POST(req: Request) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: CreateBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求体格式错误' }, { status: 400 }); }
  if (typeof body.projectId !== 'string' || !body.projectId.trim()) {
    return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  }
  const projectId = body.projectId;
  if (body.shotId !== undefined && typeof body.shotId !== 'string') {
    return NextResponse.json({ error: 'shotId 必须是 string' }, { status: 400 });
  }
  const { data: membership } = await localClient.from('project_members')
    .select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '无权访问该项目' }, { status: 403 });
  if (!['owner', 'editor'].includes(membership.role)) {
    return NextResponse.json({ error: '当前角色没有视频生成权限' }, { status: 403 });
  }
  if (body.shotId && !(await shotBelongsToProject(localClient, body.shotId, projectId))) {
    return NextResponse.json({ error: '镜头不属于当前项目' }, { status: 403 });
  }

  let input: SeedanceInput;
  try {
    input = {
      model: strictString(body.model, 'doubao-seedance-2-0', 'model'),
      prompt: strictString(body.prompt, '', 'prompt'),
      references: strictReferences(body.references),
      duration: strictNumber(body.duration, 5, 'duration'),
      ratio: strictString(body.ratio, 'adaptive', 'ratio'),
      resolution: strictString(body.resolution, '720p', 'resolution'),
      watermark: strictBoolean(body.watermark, false, 'watermark'),
      generateAudio: strictBoolean(body.generateAudio, true, 'generateAudio'),
    };
    assertSeedanceInputTypes(input);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '视频参数无效' }, { status: 400 });
  }

  let pendingTask: Record<string, any> | null = null;
  let pendingLedgerEntry: ReturnType<typeof buildVideoLedgerEntry> | null = null;
  try {
    const pricing = estimateVideoPrice({ model: input.model, duration: input.duration, resolution: input.resolution });
    const budget = await assertMonthlyBudgetAvailable({ userId: user.id, estimatedCostUsd: pricing?.estimatedCostUsd });
    if (!budget.allowed) return NextResponse.json({ error: budget.message, code: budget.code }, { status: 402 });
    const references = await Promise.all(input.references.map((reference) => providerReference(reference, user.id, projectId)));
    const providerInput = { ...input, references };
    try {
      buildSeedanceRequest(providerInput);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : '视频参数无效' }, { status: 400 });
    }
    const requestRecord = {
      prompt: providerInput.prompt,
      references: input.references,
      duration: providerInput.duration,
      ratio: providerInput.ratio,
      resolution: providerInput.resolution,
      watermark: providerInput.watermark,
      generateAudio: providerInput.generateAudio,
    };
    const pendingExternalTaskId = `pending-${randomUUID()}`;
    const pendingInsert = await localClient.from('generation_tasks').insert({
      project_id: projectId,
      shot_id: body.shotId || null,
      user_id: user.id,
      kind: 'video',
      provider: 'wetoken',
      model: input.model,
      external_task_id: pendingExternalTaskId,
      status: 'submitting',
      request: requestRecord,
    }).select('id,project_id,shot_id,model,external_task_id,status,request,output,error,created_at').single();
    if (pendingInsert.error || !pendingInsert.data) {
      return NextResponse.json({ error: `创建本地视频任务失败：${pendingInsert.error?.message || 'no row returned'}` }, { status: 500 });
    }
    const persistedPendingTask = pendingInsert.data;
    pendingTask = persistedPendingTask;
    pendingLedgerEntry = buildVideoLedgerEntry({
      requestId: `wetoken-video:${persistedPendingTask.id}`,
      providerRequestId: pendingExternalTaskId,
      userId: user.id,
      projectId,
      provider: 'wetoken',
      model: providerInput.model,
      duration: providerInput.duration,
      resolution: providerInput.resolution,
      generateAudio: providerInput.generateAudio,
      pricing,
    });
    await recordUsageRequired(pendingLedgerEntry);

    const created = await createWetokenVideoTask(providerInput);
    const completedAt = ['succeeded', 'failed', 'expired'].includes(created.status)
      ? new Date().toISOString()
      : null;
    await updateVideoUsageBestEffort({
      requestId: pendingLedgerEntry.request_id,
      providerRequestId: created.externalTaskId,
      providerStatus: created.status,
      completedAt,
      reportedCostUsd: extractReportedCostUsd(created.raw),
      priceSnapshot: pendingLedgerEntry.price_snapshot,
    });

    const { data: task, error } = await localClient.from('generation_tasks').update({
      external_task_id: created.externalTaskId,
      status: created.status,
      completed_at: completedAt,
    }).eq('id', persistedPendingTask.id).eq('user_id', user.id).eq('external_task_id', pendingExternalTaskId)
      .select('id,project_id,shot_id,model,external_task_id,status,request,output,error,created_at').single();
    if (error) {
      const fallback = await localClient.from('generation_tasks').update({
        external_task_id: created.externalTaskId,
        status: 'unknown',
        output: { provider_task_id: created.externalTaskId },
        error: 'Wetoken 已返回任务编号，但本地状态更新失败，请勿重新提交',
      }).eq('id', persistedPendingTask.id).eq('user_id', user.id)
        .select('id,project_id,shot_id,model,external_task_id,status,request,output,error,created_at').maybeSingle();
      return NextResponse.json({
        ok: true,
        task: fallback.data || { ...persistedPendingTask, external_task_id: created.externalTaskId, status: 'unknown', output: { provider_task_id: created.externalTaskId } },
        warning: `视频任务已提交给 Wetoken，但本地状态更新失败：${error.message}`,
      }, { status: 202 });
    }
    await localClient.from('generations').insert({
      project_id: projectId, user_id: user.id, kind: 'video', model: input.model, key_owner: 'company',
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true, task }, { status: 202 });
  } catch (error: any) {
    if (error instanceof VideoReferenceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const unknownSubmission = error instanceof WetokenVideoTransportError
      || (error instanceof WetokenVideoError && !isDefinitiveWetokenVideoRejection(error))
      || (error instanceof Error && error.message === 'Wetoken video task ID missing');
    if (unknownSubmission) {
      if (pendingTask && pendingLedgerEntry) {
        await updateVideoUsageBestEffort({
          requestId: pendingLedgerEntry.request_id,
          providerStatus: 'unknown',
        });
        const updated = await localClient.from('generation_tasks').update({
          status: 'unknown',
          error: 'Wetoken 未返回可确认的任务编号，请先在 Wetoken 后台核对，不要立即重试',
        }).eq('id', pendingTask.id).eq('user_id', user.id)
          .select('id,project_id,shot_id,model,external_task_id,status,request,output,error,created_at').maybeSingle();
        return NextResponse.json({
          ok: true,
          task: updated.data || { ...pendingTask, status: 'unknown' },
          warning: '提交结果可能未知，请先在 Wetoken 后台核对，不要立即重试',
        }, { status: 202 });
      }
      return NextResponse.json({
        error: 'Wetoken 未返回可确认的任务编号，提交结果可能未知，请先在 Wetoken 后台核对，不要立即重试',
        code: 'VIDEO_SUBMISSION_UNKNOWN',
      }, { status: 503 });
    }
    if (pendingTask) {
      const failedAt = new Date().toISOString();
      if (pendingLedgerEntry) {
        await updateVideoUsageBestEffort({
          requestId: pendingLedgerEntry.request_id,
          providerStatus: 'failed',
          completedAt: failedAt,
        });
      }
      await localClient.from('generation_tasks').update({
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : '视频任务提交失败',
        completed_at: failedAt,
      }).eq('id', pendingTask.id).eq('user_id', user.id);
    }
    if (error instanceof WetokenAssetError && error.status >= 400 && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof WetokenVideoError && isDefinitiveWetokenVideoRejection(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 422 });
    }
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return NextResponse.json({
      error: isTimeout ? '提交视频任务超时，请确认任务列表后再决定是否重试' : error?.message || '视频任务提交失败',
    }, { status: isTimeout ? 504 : 502 });
  }
}
