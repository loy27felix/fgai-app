import { query } from '@/lib/local/db';

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
  try {
    await query(
      `insert into creator_generation_task_events (task_id, event, status, details)
       values ($1, $2, $3, $4::jsonb)`,
      [taskId, event, status, JSON.stringify(compactDetails(details))],
    );
  } catch (error) {
    // Event diagnostics must never interrupt the generation state machine.
    // 诊断事件写入失败不能反向中断生成任务的主状态机。
    console.error('[creator video event persistence]', {
      taskId,
      event,
      message: error instanceof Error ? error.message.slice(0, 300) : 'event persistence failed',
    });
  }
}
