import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { getWetokenVideoTask } from '@/lib/ai/video';
import { updateVideoUsageBestEffort } from '@/lib/usage/ledger';
import { extractReportedCostUsd } from '@/lib/usage/pricing';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { data: task, error } = await localClient.from('generation_tasks')
    .select('id,project_id,shot_id,user_id,model,external_task_id,status,request,output,error,created_at,updated_at,completed_at')
    .eq('id', params.id).maybeSingle();
  if (error) return NextResponse.json({ error: `读取任务失败：${error.message}` }, { status: 500 });
  if (!task) return NextResponse.json({ error: '任务不存在或无权访问' }, { status: 404 });
  const { data: membership } = await localClient.from('project_members')
    .select('role').eq('project_id', task.project_id).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: '任务不存在或无权访问' }, { status: 404 });
  if (task.external_task_id.startsWith('pending-')) {
    return NextResponse.json({ ok: true, task });
  }

  try {
    const result = await getWetokenVideoTask(task.external_task_id);
    const terminal = ['succeeded', 'failed', 'expired'].includes(result.status);
    const reportedCostUsd = extractReportedCostUsd(result.usage);
    const output = result.videoUrl ? { videoUrl: result.videoUrl, usage: result.usage || null } : { usage: result.usage || null };
    const patch = {
      status: result.status,
      output,
      error: result.error || null,
      completed_at: terminal ? (task.completed_at || new Date().toISOString()) : null,
    };
    const { error: updateError } = await localClient.from('generation_tasks').update(patch).eq('id', task.id);
    const ledgerUpdated = await updateVideoUsageBestEffort({
      requestId: `wetoken-video:${task.id}`,
      providerRequestId: result.externalTaskId,
      providerStatus: result.status,
      completedAt: patch.completed_at,
      reportedCostUsd,
    });
    if (!ledgerUpdated) {
      // Fall back to the historical request key for tasks created before local task IDs became authoritative.
      // 兼容旧任务的外部请求键；新任务统一使用本地 task ID 保证提交前即可写入账本。
      await updateVideoUsageBestEffort({
        requestId: `wetoken-video:${task.external_task_id}`,
        providerRequestId: result.externalTaskId,
        providerStatus: result.status,
        completedAt: patch.completed_at,
        reportedCostUsd,
      });
    }
    if (updateError) return NextResponse.json({ error: `同步任务状态失败：${updateError.message}` }, { status: 500 });
    if (result.status === 'succeeded' && result.videoUrl && task.shot_id) {
      const { error: shotError } = await localClient.from('shots').update({ video_url: result.videoUrl }).eq('id', task.shot_id);
      if (shotError) return NextResponse.json({ error: `视频已生成，但写回镜头失败：${shotError.message}` }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      task: { ...task, ...patch },
    });
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return NextResponse.json({
      error: isTimeout ? '查询视频任务超时，请稍后重试' : error?.message || '查询视频任务失败',
    }, { status: isTimeout ? 504 : 502 });
  }
}
