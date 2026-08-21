import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import {
  generateWetokenImage,
  providerRequestIdFromImageDiagnostic,
  WetokenImageResultError,
} from '@/lib/ai/image';
import { getImageModel } from '@/lib/imageModels';
import { slugType } from '@/lib/types';
import { buildImageLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';
import { estimateImagePrice, extractReportedCostUsd } from '@/lib/usage/pricing';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import { readLocalFile } from '@/lib/local/storage';
import { logCreatorImageEvent, logCreatorImageFailure } from '@/lib/creator/image-logging';
import { randomId } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SHOT_FIELDS = ['frame_path', 'keyframe_path', 'storyboard_path'] as const;
type ShotField = typeof SHOT_FIELDS[number];
type RequestBody = {
  projectId?: string;
  type?: string;
  model?: string;
  size?: string;
  prompt?: string;
  refImages?: string[];
  refTypes?: string[];
  refUrls?: string[];
  shotId?: string;
  shotField?: string;
};

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

async function referenceFromStorageUrl(value: string) {
  const url = new URL(value, 'http://local');
  if (url.pathname !== '/api/local/storage/content' || url.searchParams.get('bucket') !== 'project-assets') throw new Error('参考图 URL 不属于本地媒体服务');
  const bytes = new Uint8Array(await readLocalFile('project-assets', url.searchParams.get('path') || ''));
  if (bytes.byteLength > 10_000_000) throw new Error('单张参考图不能超过 10MB');
  return {
    data: Buffer.from(bytes).toString('base64'),
    mimeType: url.searchParams.get('path')?.endsWith('.jpg') || url.searchParams.get('path')?.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
  };
}

export async function POST(req: Request) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: RequestBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求体格式错误' }, { status: 400 }); }

  const projectId = body.projectId || '';
  const prompt = (body.prompt || '').trim();
  const model = body.model || 'gpt-image-2';
  if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: 'prompt 为空' }, { status: 400 });
  if (!getImageModel(model)) return NextResponse.json({ error: `不支持的图片模型：${model}` }, { status: 400 });

  const { data: membership } = await localClient.from('project_members')
    .select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '无权访问该项目' }, { status: 403 });
  if (!['owner', 'editor'].includes(membership.role)) {
    return NextResponse.json({ error: '当前角色没有生成权限' }, { status: 403 });
  }

  const refImages = Array.isArray(body.refImages) ? body.refImages : [];
  const refTypes = Array.isArray(body.refTypes) ? body.refTypes : [];
  const refUrls = Array.isArray(body.refUrls) ? body.refUrls : [];
  if (refImages.length + refUrls.length > 4) return NextResponse.json({ error: '参考图最多 4 张' }, { status: 400 });
  if (refImages.some((data) => typeof data !== 'string') || refImages.reduce((sum, data) => sum + data.length, 0) > 3_000_000) {
    return NextResponse.json({ error: '内嵌参考图过大，请先上传到项目素材库' }, { status: 400 });
  }
  if (refTypes.some((type) => !type.startsWith('image/'))) {
    return NextResponse.json({ error: '参考素材必须是图片' }, { status: 400 });
  }
  if (refUrls.some((url) => typeof url !== 'string')) {
    return NextResponse.json({ error: '参考图 URL 格式无效' }, { status: 400 });
  }
  const inlineReferences = refImages.map((data, index) => ({
    data,
    mimeType: refTypes[index] || 'image/png',
  }));
  const toShot = Boolean(body.shotId && body.shotField && SHOT_FIELDS.includes(body.shotField as ShotField));
  if ((body.shotId || body.shotField) && !toShot) {
    return NextResponse.json({ error: '镜头目标参数无效' }, { status: 400 });
  }
  if (toShot) {
    const { data: shot } = await localClient.from('shots').select('id,scene_id').eq('id', body.shotId as string).maybeSingle();
    const { data: scene } = shot
      ? await localClient.from('scenes').select('id,episode_id').eq('id', shot.scene_id).maybeSingle()
      : { data: null };
    const { data: episode } = scene
      ? await localClient.from('episodes').select('id,project_id').eq('id', scene.episode_id).maybeSingle()
      : { data: null };
    if (!episode || episode.project_id !== projectId) {
      return NextResponse.json({ error: '镜头不属于当前项目' }, { status: 403 });
    }
  }

  const requestId = `image-api:${randomId()}`;
  let providerRequestId: string | undefined;
  try {
    const pricing = estimateImagePrice(model, body.size || '1024x1024');
    const budget = await assertMonthlyBudgetAvailable({ userId: user.id, estimatedCostUsd: pricing?.estimatedCostUsd });
    if (!budget.allowed) return NextResponse.json({ error: budget.message, code: budget.code }, { status: 402 });
    const startedAt = Date.now();
    const urlReferences = await Promise.all(refUrls.map(referenceFromStorageUrl));
    const references = [...inlineReferences, ...urlReferences];
    logCreatorImageEvent('legacy_request_started', {
      requestId,
      projectId,
      model,
      size: body.size || '1024x1024',
      promptChars: prompt.length,
      referenceCount: references.length,
    });
    const generated = await generateWetokenImage({
      model,
      prompt,
      size: body.size || '1024x1024',
      references,
      trace: { requestId },
    });
    providerRequestId = providerRequestIdFromImageDiagnostic(generated.providerDiagnostic);
    const ledgerRecorded = await recordUsageBestEffort(buildImageLedgerEntry({
      requestId,
      providerRequestId,
      userId: user.id,
      projectId,
      provider: 'wetoken',
      model,
      resolution: body.size || '1024x1024',
      pricing,
      durationMs: Date.now() - startedAt,
      reportedCostUsd: extractReportedCostUsd(generated.usage),
    }));
    logCreatorImageEvent(
      ledgerRecorded ? 'legacy_ledger_recorded' : 'legacy_ledger_record_failed',
      {
        requestId,
        providerRequestId,
        projectId,
        model,
        durationMs: Date.now() - startedAt,
      },
      ledgerRecorded ? 'info' : 'warn',
    );

    const persistenceFailure = (phase: string, error: unknown, message: string) => {
      logCreatorImageFailure('legacy_request_failed', error, {
        requestId,
        providerRequestId,
        projectId,
        model,
        phase,
        possiblyCharged: true,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    };

    const ext = extensionFor(generated.mimeType);
    const folder = toShot ? 'board' : slugType(body.type || '人物');
    const basename = toShot ? `${body.shotId}-${body.shotField}` : 'gen';
    const path = `${projectId}/${folder}/${basename}-${Date.now()}.${ext}`;
    const upload = await localClient.storage.from('project-assets').upload(path, generated.bytes, {
      contentType: generated.mimeType,
      upsert: false,
    });
    if (upload.error) return persistenceFailure('result_upload', upload.error, `存储失败：${upload.error.message}`);

    const publicUrl = localClient.storage.from('project-assets').getPublicUrl(path).data.publicUrl;
    if (toShot) {
      const shotField = body.shotField as ShotField;
      const { error } = await localClient.from('shots').update({ [shotField]: path })
        .eq('id', body.shotId as string);
      if (error) return persistenceFailure('shot_update', error, `写回镜头失败：${error.message}`);
    } else {
      const { error } = await localClient.from('assets').insert({
        project_id: projectId,
        name: prompt.slice(0, 40),
        type: body.type || '人物',
        source: 'generated',
        storage_path: path,
        params: { model, prompt, size: body.size || '1024x1024', refs: references.length },
      });
      if (error) return persistenceFailure('asset_insert', error, `入库失败：${error.message}`);
    }

    const kind = body.shotField === 'keyframe_path' ? 'keyframe'
      : body.shotField === 'storyboard_path' ? 'storyboard'
        : body.shotField === 'frame_path' ? 'board'
          : references.length ? 'image-edit' : 'image';
    try {
      const generationRecord = await localClient.from('generations').insert({
        project_id: projectId, user_id: user.id, kind, model, key_owner: 'company',
      });
      if (generationRecord.error) throw generationRecord.error;
    } catch (error) {
      logCreatorImageFailure('legacy_generation_record_failed', error, {
        requestId,
        providerRequestId,
        projectId,
        model,
        possiblyCharged: true,
      });
    }

    logCreatorImageEvent('legacy_request_completed', {
      requestId,
      providerRequestId,
      projectId,
      model,
      durationMs: Date.now() - startedAt,
      bytes: generated.bytes.byteLength,
      mimeType: generated.mimeType,
    });
    return NextResponse.json({ ok: true, path, url: publicUrl, mimeType: generated.mimeType });
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const message = isTimeout ? '图片生成超时，请稍后重试或换用 Flash 模型' : error?.message || '图片生成异常';
    logCreatorImageFailure('legacy_request_failed', error, {
      requestId,
      providerRequestId,
      projectId,
      model,
      timeout: isTimeout,
      ...(error instanceof WetokenImageResultError && error.diagnostic
        ? { providerDiagnostic: error.diagnostic }
        : {}),
    });
    return NextResponse.json({ error: message }, { status: isTimeout ? 504 : 502 });
  }
}
