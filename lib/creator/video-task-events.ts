import { query } from '@/lib/local/db';
import { logServerFailure } from '@/lib/observability/server-log';
import { recordAuditEvent } from '@/lib/observability/audit-event';

type VideoTaskEventDetails = Record<string, string | number | boolean | null | undefined>;

function compactDetails(details: VideoTaskEventDetails) {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

export async function recordVideoTaskEvent(
  taskId: string,
  event: string,
  status: string | null,
  details: VideoTaskEventDetails = {},
) {
  const compact = compactDetails(details);
  try {
    await query(
      `insert into creator_generation_task_events (task_id, event, status, details)
       values ($1, $2, $3, $4::jsonb)`,
      [taskId, event, status, JSON.stringify(compact)],
    );
  } catch (error) {
    // Event diagnostics must never interrupt the generation state machine.
    // 诊断事件写入失败不能反向中断生成任务的主状态机。
    logServerFailure('creator_video_task_event', error, {
      feature: 'creator_video',
      stage: 'event_persistence_failed',
      taskId,
      event,
    });
  }

  const outcome = event.includes('failed') || event.includes('error')
    ? 'failed'
    : event.includes('reconciliation')
      ? 'unknown'
      : event.includes('acknowledged') || event.includes('succeeded') || event.includes('settled')
        ? 'succeeded'
        : 'started';
  await recordAuditEvent({
    feature: 'creator_video',
    action: 'task',
    resourceType: 'creator_generation_task',
    resourceId: taskId,
    stage: event,
    outcome,
    statusAfter: status,
    data: compact,
    level: outcome === 'failed' ? 'error' : outcome === 'unknown' ? 'warn' : 'info',
  });
}
