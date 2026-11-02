import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { query } from '@/lib/local/db';
import { enqueueSupportMessage, supportStages } from '@/lib/support-bot/store';

import { parseSupportContext } from '@/lib/support-bot/context';
import { captureSupportRuntime } from '@/lib/support-bot/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const MAX_BODY_BYTES = 28 * 1024 * 1024;
class BodyTooLarge extends Error {}

async function userId() {
  const { data: { user } } = await createClient().auth.getUser();
  return user?.id;
}

export async function GET(request: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const conversationId = params.get('conversationId');
  if (!validId(conversationId)) return NextResponse.json({ error: '会话编号无效' }, { status: 400 });
  try {
    if (params.has('messageId') || params.has('image')) {
      const messageId = params.get('messageId');
      const image = params.get('image');
      if (!validId(messageId) || image === null || !/^[0-9]$/.test(image)) {
        return NextResponse.json({ error: '截图编号无效' }, { status: 400 });
      }
      // Fetch attachments on demand under the same ownership check, not in every poll.
      // 截图按需读取并校验归属，避免轮询重复传输大体积 base64。
      const result = await query<{ image: string | null }>(`SELECT j.images->>$4::int AS image
        FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id
        WHERE t.open_id=$1 AND t.chat_id=$2 AND j.id=$3`, [`web:${id}`, `web:${conversationId}`, messageId, Number(image)]);
      const source = result.rows[0]?.image;
      if (!source || !validateImages([source])) return NextResponse.json({ error: '截图不存在' }, { status: 404 });
      const [header, base64] = source.split(',');
      return new NextResponse(Buffer.from(base64, 'base64'), { headers: {
        'Content-Type': header.slice(5, -7),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    // Scope every read to the authenticated owner, never a caller-supplied user ID.
    // 所有读取限定登录用户，避免通过会话编号读取他人的问题。
    const result = await query(`SELECT j.id,j.text,j.status,j.stage,jsonb_array_length(j.images) AS "imageCount",j.ticket_id AS "ticketId",
      CASE WHEN j.status='completed' THEN j.diagnosis->>'userReply' ELSE NULL END AS reply
      FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id
      WHERE t.open_id=$1 AND t.chat_id=$2 ORDER BY j.created_at DESC,j.id DESC LIMIT 100`, [`web:${id}`, `web:${conversationId}`]);
    return NextResponse.json({ conversationId, messages: result.rows.reverse().map(row => ({ ...row, stage: supportStages[row.stage] || supportStages.queued })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '暂时无法读取排查记录，请稍后重试' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (process.env.SUPPORT_BOT_ENABLED !== 'true') return NextResponse.json({ error: '自助排查尚未启用' }, { status: 503 });
  let body;
  try { body = await readBody(request); } catch (error) {
    return NextResponse.json({ error: error instanceof BodyTooLarge ? '请求过大；最多 10 张处理后的截图，每张不超过 2 MiB（网页支持选择 20 MiB 原图并自动压缩）' : '请求格式无效' }, { status: error instanceof BodyTooLarge ? 413 : 400 });
  }
  if (!body || !validId(body.conversationId) || typeof body.text !== 'string' || body.text.length > 8000) {
    return NextResponse.json({ error: '请提供有效会话编号，问题文字不超过 8000 字' }, { status: 400 });
  }
  const images = validateImages(body.images);
  if (!images || (!body.text.trim() && !images.length)) return NextResponse.json({ error: '请填写问题或上传截图；最多 10 张 PNG/JPEG/WebP，处理后每张不超过 2 MiB（网页支持 20 MiB 原图）' }, { status: 400 });
  let hints;
  try { hints = parseSupportContext(body.context); }
  catch { return NextResponse.json({ error: '发生时间段无效，请选择不超过7天的完整时间范围' }, { status: 400 }); }
  try {
    const context = { ...hints, runtime: await captureSupportRuntime() };
    const messageId = `web:${randomUUID()}`;
    const result = await enqueueSupportMessage({ eventId: messageId, messageId, chatId: `web:${body.conversationId}`, openId: `web:${id}`, text: body.text.trim() || '请根据附带截图排查问题。', images, context, userId: id });
    return NextResponse.json({ ticketId: result.ticketId }, { status: 202 });
  } catch (error) {
    const limited = error instanceof Error && error.message.includes('提问过于频繁');
    return NextResponse.json({ error: limited ? '提问过于频繁，请稍后重试' : '提交失败，请稍后重试' }, { status: limited ? 429 : 503 });
  }
}

// Bound the request stream before parsing base64 JSON / 解析前限制请求流，避免大图片占用过多内存。
async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    await request.body?.cancel();
    throw new BodyTooLarge();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error('请求为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateImages(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  for (const image of value) {
    if (typeof image !== 'string') return null;
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) return null;
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > 2 * 1024 * 1024 || data.toString('base64') !== match[2]) return null;
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    const webp = data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP';
    if (!(match[1] === 'png' ? png : match[1] === 'jpeg' ? jpeg : webp)) return null;
  }
  return value;
}
