import { NextResponse } from 'next/server';
import { parseFeishuEvent, supportBotEnabled } from '@/lib/support-bot/feishu';
import { enqueueSupportMessage } from '@/lib/support-bot/store';
import { logServerEvent } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!supportBotEnabled()) return NextResponse.json({ error: '机器人尚未启用' }, { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > 128_000) return NextResponse.json({ error: '请求过大' }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: '请求为空' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 128_000) {
        await reader.cancel();
        return NextResponse.json({ error: '请求过大' }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
  } catch { return NextResponse.json({ error: '请求读取失败' }, { status: 400 }); }
  finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  let event;
  try { event = parseFeishuEvent(body, request.headers); }
  catch {
    logServerEvent('support_bot_callback_rejected', { service: 'support-bot', reason: 'event_validation_failed' }, 'warn');
    return NextResponse.json({ error: '事件校验失败' }, { status: 403 });
  }
  if (event.challenge) {
    logServerEvent('support_bot_callback_verified', { service: 'support-bot' });
    return NextResponse.json({ challenge: event.challenge });
  }
  try {
    if (event.message) {
      const queued = await enqueueSupportMessage(event.message);
      logServerEvent('support_bot_message_enqueued', {
        service: 'support-bot', ticketId: queued.ticketId, duplicate: queued.duplicate,
        eventId: event.message.eventId, messageId: event.message.messageId,
      });
    }
    return NextResponse.json({ code: 0 });
  } catch {
    logServerEvent('support_bot_message_enqueue_failed', {
      service: 'support-bot', eventId: event.message?.eventId, messageId: event.message?.messageId,
    }, 'error');
    return NextResponse.json({ error: '事件暂时无法入队，请重试' }, { status: 503 });
  }
}
