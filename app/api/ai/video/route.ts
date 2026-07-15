import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createWetokenVideoTask,
  type SeedanceInput,
  type VideoReference,
} from '@/lib/ai/video';
import { buildVideoLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';

export const runtime = 'nodejs';
export const maxDuration = 60;

type CreateBody = {
  projectId?: string;
  shotId?: string;
  model?: string;
  prompt?: string;
  references?: VideoReference[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  watermark?: boolean;
  generateAudio?: boolean;
};

async function shotBelongsToProject(supabase: ReturnType<typeof createClient>, shotId: string, projectId: string) {
  const { data: shot } = await supabase.from('shots').select('id,scene_id').eq('id', shotId).maybeSingle();
  if (!shot) return false;
  const { data: scene } = await supabase.from('scenes').select('id,episode_id').eq('id', shot.scene_id).maybeSingle();
  if (!scene) return false;
  const { data: episode } = await supabase.from('episodes').select('id,project_id').eq('id', scene.episode_id).maybeSingle();
  return episode?.project_id === projectId;
}

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get('projectId') || '';
  if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  const { data: membership } = await supabase.from('project_members')
    .select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '无权访问该项目' }, { status: 403 });
  const { data, error } = await supabase.from('generation_tasks')
    .select('id,project_id,shot_id,user_id,kind,provider,model,status,request,output,error,created_at,updated_at,completed_at')
    .eq('project_id', projectId).eq('kind', 'video').order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: `读取视频任务失败：${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, tasks: data || [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: CreateBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求体格式错误' }, { status: 400 }); }
  const projectId = body.projectId || '';
  if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
  const { data: membership } = await supabase.from('project_members')
    .select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '无权访问该项目' }, { status: 403 });
  if (!['owner', 'editor'].includes(membership.role)) {
    return NextResponse.json({ error: '当前角色没有视频生成权限' }, { status: 403 });
  }
  if (body.shotId && !(await shotBelongsToProject(supabase, body.shotId, projectId))) {
    return NextResponse.json({ error: '镜头不属于当前项目' }, { status: 403 });
  }

  const input: SeedanceInput = {
    model: body.model || 'doubao-seedance-2-0',
    prompt: body.prompt || '',
    references: Array.isArray(body.references) ? body.references : [],
    duration: body.duration ?? 5,
    ratio: body.ratio || 'adaptive',
    resolution: body.resolution || '720p',
    watermark: body.watermark ?? false,
    generateAudio: body.generateAudio ?? true,
  };

  try {
    const created = await createWetokenVideoTask(input);
    await recordUsageBestEffort(buildVideoLedgerEntry({
      requestId: `wetoken-video:${created.externalTaskId}`,
      providerRequestId: created.externalTaskId,
      userId: user.id,
      projectId,
      provider: 'wetoken',
      model: input.model,
      duration: input.duration,
      resolution: input.resolution,
      generateAudio: input.generateAudio,
    }));

    const requestRecord = {
      prompt: input.prompt,
      references: input.references,
      duration: input.duration,
      ratio: input.ratio,
      resolution: input.resolution,
      watermark: input.watermark,
      generateAudio: input.generateAudio,
    };
    const { data: task, error } = await supabase.from('generation_tasks').insert({
      project_id: projectId,
      shot_id: body.shotId || null,
      user_id: user.id,
      kind: 'video',
      provider: 'wetoken',
      model: input.model,
      external_task_id: created.externalTaskId,
      status: created.status,
      request: requestRecord,
    }).select('id,project_id,shot_id,model,status,created_at').single();
    if (error) {
      return NextResponse.json({
        error: `视频任务已提交给 Wetoken，但本地记录失败：${error.message}`,
        externalTaskId: created.externalTaskId,
      }, { status: 500 });
    }
    await supabase.from('generations').insert({
      project_id: projectId, user_id: user.id, kind: 'video', model: input.model, key_owner: 'company',
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true, task }, { status: 202 });
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return NextResponse.json({
      error: isTimeout ? '提交视频任务超时，请确认任务列表后再决定是否重试' : error?.message || '视频任务提交失败',
    }, { status: isTimeout ? 504 : 502 });
  }
}
