import { assertSupportPrimaryEnvironment } from './environment';
import { setTimeout as delay } from 'node:timers/promises';
import { query } from '@/lib/local/db';
import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';
import { supportStages } from './store';
import type { SupportMessage } from './web-client';

export async function readSupportMessages(userId: string, conversationId: string) {
  await assertSupportPrimaryEnvironment();
  const result = await query<SupportMessage>(`SELECT j.id,j.text,j.status,j.stage,j.progress,jsonb_array_length(j.images) AS "imageCount",j.ticket_id AS "ticketId",
    CASE WHEN j.status='completed' THEN j.diagnosis->>'userReply' ELSE NULL END AS reply,
    CASE WHEN j.feedback_rating IS NOT NULL THEN jsonb_build_object('rating',j.feedback_rating,'correction',j.feedback_correction,'updatedAt',j.feedback_updated_at) ELSE NULL END AS feedback
    FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id
    WHERE t.open_id=$1 AND t.chat_id=$2 ORDER BY j.created_at DESC,j.id DESC LIMIT 100`, [`web:${userId}`, `web:${conversationId}`]);
  return result.rows.reverse().map(row => ({ ...row, stage: supportStages[row.stage || 'queued'] || supportStages.queued }));
}

export function supportConversationStream(request: Request, userId: string, conversationId: string, initial: Awaited<ReturnType<typeof readSupportMessages>>, traceId: string) {
  const started = Date.now();
  const fields = { service: 'support-bot', route: '/api/support-bot/web', traceId, conversationId, ticketId: initial.at(-1)?.ticketId, jobId: initial.at(-1)?.id };
  const abort = new AbortController();
  const stop = () => abort.abort();
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const previous = new Map(initial.map(message => [message.id, JSON.stringify(message)]));
      const until = Date.now() + 55_000;
      let heartbeat = Date.now();
      let active = initial.some(message => ['pending', 'processing'].includes(message.status));
      let reason = 'renewal';
      let stage = 'snapshot';
      try {
        if (abort.signal.aborted) return;
        controller.enqueue(encoder.encode('retry: 1500\n\n'));
        send('snapshot', { messages: initial });
        // The worker is a separate process; database snapshots survive reconnects and restarts.
        // worker 独立运行；数据库快照保证断线、刷新与进程重启后可恢复，不重复提交问题。
        while (!abort.signal.aborted && Date.now() < until) {
          await delay(active ? 750 : 2500, undefined, { signal: abort.signal });
          stage = 'read_messages';
          const messages = await readSupportMessages(userId, conversationId);
          if (abort.signal.aborted) break;
          active = messages.some(message => ['pending', 'processing'].includes(message.status));
          if ((controller.desiredSize ?? 0) <= 0) continue;
          stage = 'send_updates';
          for (const message of messages) {
            const serialized = JSON.stringify(message);
            if (previous.get(message.id) === serialized) continue;
            send('message', { message });
            previous.set(message.id, serialized);
          }
          if (Date.now() - heartbeat >= 10_000) {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
            heartbeat = Date.now();
          }
        }
        // A planned renewal is not a transport failure; clients reconnect without an alert.
        // 定时续连不是传输故障，客户端收到后静默重建连接。
        stage = 'renewal';
        if (!abort.signal.aborted) send('reconnect', { reason: 'renewal', traceId });
      } catch (error) {
        if (!abort.signal.aborted) {
          reason = 'error';
          logServerFailure('support_bot_web_stream_failed', error, { ...fields, stage, durationMs: Date.now() - started });
          send('unavailable', { error: '实时连接暂时中断，正在重连；排查任务仍会继续。', traceId });
        }
      } finally {
        request.signal.removeEventListener('abort', stop);
        logServerEvent('support_bot_web_stream_closed', { ...fields, reason: abort.signal.aborted ? 'client_disconnect' : reason, durationMs: Date.now() - started });
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel: stop,
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    'X-FG-Trace-Id': traceId,
  } });
}
