import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateWetokenImage } from '@/lib/ai/image';
import { getImageModel } from '@/lib/imageModels';
import { slugType } from '@/lib/types';
import { buildImageLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';
import { estimateImagePrice, extractReportedCostUsd } from '@/lib/usage/pricing';

export const runtime = 'nodejs';
export const maxDuration = 120;

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 环境变量');
  const url = new URL(value);
  const allowed = new URL(supabaseUrl);
  if (url.origin !== allowed.origin || !url.pathname.startsWith('/storage/v1/object/public/project-assets/')) {
    throw new Error('参考图 URL 不属于当前 Supabase Storage');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`读取参考图失败 (${response.status})`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 10_000_000) throw new Error('单张参考图不能超过 10MB');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 10_000_000) throw new Error('单张参考图不能超过 10MB');
  return {
    data: Buffer.from(bytes).toString('base64'),
    mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png',
  };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: RequestBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求体格式错误' }, { status: 400 }); }

  const projectId = body.projectId || '';
  const prompt = (body.prompt || '').trim();
  const model = body.model || 'gpt-image-2';
  if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: 'prompt 为空' }, { status: 400 });
  if (!getImageModel(model)) return NextResponse.json({ error: `不支持的图片模型：${model}` }, { status: 400 });

  const { data: membership } = await supabase.from('project_members')
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
    const { data: shot } = await supabase.from('shots').select('id,scene_id').eq('id', body.shotId as string).maybeSingle();
    const { data: scene } = shot
      ? await supabase.from('scenes').select('id,episode_id').eq('id', shot.scene_id).maybeSingle()
      : { data: null };
    const { data: episode } = scene
      ? await supabase.from('episodes').select('id,project_id').eq('id', scene.episode_id).maybeSingle()
      : { data: null };
    if (!episode || episode.project_id !== projectId) {
      return NextResponse.json({ error: '镜头不属于当前项目' }, { status: 403 });
    }
  }

  try {
    const urlReferences = await Promise.all(refUrls.map(referenceFromStorageUrl));
    const references = [...inlineReferences, ...urlReferences];
    const generated = await generateWetokenImage({
      model,
      prompt,
      size: body.size || '1024x1024',
      references,
    });
    await recordUsageBestEffort(buildImageLedgerEntry({
      userId: user.id,
      projectId,
      provider: 'wetoken',
      model,
      resolution: body.size || '1024x1024',
      pricing: estimateImagePrice(model, body.size || '1024x1024'),
      reportedCostUsd: extractReportedCostUsd(generated.usage),
    }));

    const ext = extensionFor(generated.mimeType);
    const folder = toShot ? 'board' : slugType(body.type || '人物');
    const basename = toShot ? `${body.shotId}-${body.shotField}` : 'gen';
    const path = `${projectId}/${folder}/${basename}-${Date.now()}.${ext}`;
    const upload = await supabase.storage.from('project-assets').upload(path, generated.bytes, {
      contentType: generated.mimeType,
      upsert: false,
    });
    if (upload.error) return NextResponse.json({ error: `存储失败：${upload.error.message}` }, { status: 500 });

    const publicUrl = supabase.storage.from('project-assets').getPublicUrl(path).data.publicUrl;
    if (toShot) {
      const shotField = body.shotField as ShotField;
      const { error } = await supabase.from('shots').update({ [shotField]: path })
        .eq('id', body.shotId as string);
      if (error) return NextResponse.json({ error: `写回镜头失败：${error.message}` }, { status: 500 });
    } else {
      const { error } = await supabase.from('assets').insert({
        project_id: projectId,
        name: prompt.slice(0, 40),
        type: body.type || '人物',
        source: 'generated',
        storage_path: path,
        params: { model, prompt, size: body.size || '1024x1024', refs: references.length },
      });
      if (error) return NextResponse.json({ error: `入库失败：${error.message}` }, { status: 500 });
    }

    const kind = body.shotField === 'keyframe_path' ? 'keyframe'
      : body.shotField === 'storyboard_path' ? 'storyboard'
        : body.shotField === 'frame_path' ? 'board'
          : references.length ? 'image-edit' : 'image';
    await supabase.from('generations').insert({
      project_id: projectId, user_id: user.id, kind, model, key_owner: 'company',
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true, path, url: publicUrl, mimeType: generated.mimeType });
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const message = isTimeout ? '图片生成超时，请稍后重试或换用 Flash 模型' : error?.message || '图片生成异常';
    return NextResponse.json({ error: message }, { status: isTimeout ? 504 : 502 });
  }
}
