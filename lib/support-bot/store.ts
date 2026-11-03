import { assertSupportPrimaryEnvironment } from './environment';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '@/lib/local/db';
import type { SupportContext } from './context';

export type SupportMessage = { eventId: string; messageId: string; chatId: string; openId: string; text: string; images?: string[]; context?: SupportContext; userId?: string; threadId?: string; isGroup?: boolean; botMentioned?: boolean };
export type DiagnosisResult = { userReply: string; internalSummary: string; needsDeveloper: boolean; module: string; evidence: unknown[]; guidanceOnly?: boolean; closed?: boolean };
export type SupportJob = SupportMessage & { id: string; ticketId: string; attempts: number; leaseToken: string; diagnosis: DiagnosisResult | null };
export class SupportConversationBusy extends Error {
  constructor() { super('当前问题正在排查，请先终止或等待完成'); this.name = 'SupportConversationBusy'; }
}
let schemaReady: Promise<void> | undefined;
export async function ensureSupportSchema() {
  await assertSupportPrimaryEnvironment();
  schemaReady ??= query('SELECT images, context, stage, progress FROM support_bot_jobs LIMIT 0').then(() => undefined).catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}
export async function enqueueSupportMessage(message: SupportMessage) {
  await ensureSupportSchema();
  if (!message.text.trim() || message.text.length > 8000) throw new Error('问题内容需为 1 到 8000 字符');
  return withTransaction(async (db) => {
    // Serialize a conversation, including duplicate callbacks, across workers.
    // 按会话加事务锁，避免回调重试及并发续问创建重复工单。
    const conversationKey = message.isGroup
      ? `group:${message.chatId}:${message.threadId || ''}`
      : `user:${message.openId}:${message.chatId}:${message.threadId || ''}`;
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [conversationKey]);
    const previous = await db.query('SELECT id,ticket_id FROM support_bot_jobs WHERE event_id=$1 OR message_id=$2', [message.eventId,message.messageId]);
    if (previous.rows[0]) return { ticketId: previous.rows[0].ticket_id as string, jobId: previous.rows[0].id as string, duplicate: true };
    if (message.chatId.startsWith('web:')) {
      const active = await db.query("SELECT 1 FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id WHERE t.open_id=$1 AND t.chat_id=$2 AND j.status IN ('pending','processing') LIMIT 1", [message.openId, message.chatId]);
      if (active.rowCount) throw new SupportConversationBusy();
    }
    // Accept unmentioned replies only inside an active support topic.
    // 未 @ 回复仅在既有未关闭的机器人话题中入队，避免处理群内其他消息。
    if (message.isGroup && !message.botMentioned) {
      const activeThread = await db.query("SELECT id FROM support_bot_tickets WHERE chat_id=$1 AND thread_id=$2 AND status='open' AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1", [message.chatId,message.threadId || '']);
      if (!activeThread.rows[0]) return { ticketId: '', duplicate: false, ignored: true as const };
    }
    const pressure=await db.query("SELECT count(*) FILTER(WHERE j.created_at>now()-interval '1 minute')::int recent,count(*) FILTER(WHERE j.status IN ('pending','processing'))::int queued FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id WHERE t.open_id=$1",[message.openId]);
    if (pressure.rows[0].recent>=5 || pressure.rows[0].queued>=10) throw new Error('提问过于频繁，请稍后重试');
    if (message.text.trim()==='新问题') {
      if (message.isGroup) await db.query("UPDATE support_bot_tickets SET status='closed' WHERE chat_id=$1 AND thread_id=$2",[message.chatId,message.threadId || '']);
      else await db.query("UPDATE support_bot_tickets SET status='closed' WHERE open_id=$1 AND chat_id=$2 AND thread_id=$3",[message.openId,message.chatId,message.threadId || '']);
    }
    // Group topics are shared conversations, so any member can continue the same ticket.
    // 群主题由所有参与者共同续问，不按首条消息发送者拆分工单。
    const existing = message.isGroup
      ? await db.query("SELECT id FROM support_bot_tickets WHERE chat_id=$1 AND thread_id=$2 AND status='open' AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1", [message.chatId,message.threadId || ''])
      : await db.query("SELECT id FROM support_bot_tickets WHERE open_id=$1 AND chat_id=$2 AND thread_id=$3 AND status='open' AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1", [message.openId,message.chatId,message.threadId || '']);
    const ticketId = existing.rows[0]?.id || randomUUID();
    await db.query('INSERT INTO support_bot_tickets(id,open_id,chat_id,thread_id,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET updated_at=now(),user_id=COALESCE(support_bot_tickets.user_id,EXCLUDED.user_id)', [ticketId,message.openId,message.chatId,message.threadId || '',message.userId || null]);
    const jobId = randomUUID();
    await db.query('INSERT INTO support_bot_jobs(id,event_id,message_id,ticket_id,text,is_group,images,context) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',[jobId,message.eventId,message.messageId,ticketId,message.text,!!message.isGroup,JSON.stringify(message.images || []),JSON.stringify(message.context || {})]);
    if (message.text.trim()==='关闭问题') await db.query("UPDATE support_bot_tickets SET status='closed' WHERE id=$1",[ticketId]);
    return { ticketId: ticketId as string, jobId, duplicate: false };
  });
}
export async function cancelSupportJobs(userId: string, conversationId: string, jobIds: string[]) {
  return withTransaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`user:web:${userId}:web:${conversationId}:`]);
    const owned = await db.query('SELECT j.id FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id WHERE t.open_id=$1 AND t.chat_id=$2 AND j.id=ANY($3::text[])', [`web:${userId}`, `web:${conversationId}`, jobIds]);
    if (owned.rowCount !== new Set(jobIds).size) return null;
    // Revoke the lease atomically; a late worker must never publish or retry a cancelled job.
    // 原子撤销租约，防止迟到的 worker 写回结果或将已终止任务重新入队。
    const result = await db.query("UPDATE support_bot_jobs SET status='cancelled',stage='cancelled',lease_token=NULL,lease_until=NULL,diagnosis=NULL,error=NULL WHERE id=ANY($1::text[]) AND status IN ('pending','processing') RETURNING id", [jobIds]);
    return result.rowCount ?? 0;
  });
}
export async function isSupportJobCancelled(job: Pick<SupportJob, 'id'>) {
  const result = await query("SELECT 1 FROM support_bot_jobs WHERE id=$1 AND status='cancelled'", [job.id]);
  return !!result.rowCount;
}
export async function claimSupportJob(webOnly = false): Promise<SupportJob | null> {
  await ensureSupportSchema();
  await query("UPDATE support_bot_jobs j SET status='failed',error='任务租约过期且重试已用尽' WHERE status='processing' AND lease_until<now() AND attempts>=4 AND ($1::boolean=false OR EXISTS(SELECT 1 FROM support_bot_tickets t WHERE t.id=j.ticket_id AND t.chat_id LIKE 'web:%'))", [webOnly]);
  const token = randomUUID();
  const result = await query(`WITH candidate AS (
    SELECT j.id FROM support_bot_jobs j WHERE ($2::boolean=false OR EXISTS(SELECT 1 FROM support_bot_tickets wt WHERE wt.id=j.ticket_id AND wt.chat_id LIKE 'web:%')) AND ((j.status='pending' AND j.available_at<=now()) OR (j.status='processing' AND j.lease_until<now())) AND j.attempts<4 AND NOT EXISTS(SELECT 1 FROM support_bot_jobs active WHERE active.ticket_id=j.ticket_id AND active.id<>j.id AND active.status='processing' AND active.lease_until>now())
    AND NOT EXISTS(SELECT 1 FROM support_bot_jobs earlier WHERE earlier.ticket_id=j.ticket_id AND (earlier.created_at,earlier.id)<(j.created_at,j.id) AND earlier.status IN ('pending','processing'))
    ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (UPDATE support_bot_jobs j SET status='processing',stage='understanding',progress='[]'::jsonb,attempts=attempts+1,lease_token=$1,lease_until=now()+interval '15 minutes' FROM candidate WHERE j.id=candidate.id RETURNING j.*)
  SELECT claimed.*,t.open_id,t.chat_id,t.thread_id,t.user_id FROM claimed JOIN support_bot_tickets t ON t.id=claimed.ticket_id`,[token,webOnly]);
  const row = result.rows[0];
  return row ? { id:row.id,ticketId:row.ticket_id,eventId:row.event_id,messageId:row.message_id,openId:row.open_id,chatId:row.chat_id,threadId:row.thread_id,text:row.text,userId:row.user_id || undefined,context:row.context,images:row.images || [],attempts:row.attempts,leaseToken:token,diagnosis:row.diagnosis,isGroup:row.is_group } : null;
}
export async function saveSupportDiagnosis(job: SupportJob, result: DiagnosisResult) {
  const saved = await query("UPDATE support_bot_jobs SET diagnosis=$3::jsonb WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now() RETURNING id",[job.id,job.leaseToken,JSON.stringify(result)]);
  if (!saved.rowCount) throw new Error('诊断任务租约已失效');
}
export async function completeSupportJob(job: SupportJob) {
  const result = await query("UPDATE support_bot_jobs SET status='completed',stage='completed',lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now() RETURNING id",[job.id,job.leaseToken]);
  if (!result.rowCount) throw new Error('诊断任务租约已失效');
}
export async function failSupportJob(job: SupportJob, error: unknown) {
  await query("UPDATE support_bot_jobs SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,stage='retrying',available_at=now()+interval '1 minute',lease_until=NULL,error=$3 WHERE id=$1 AND lease_token=$2 AND status='processing'",[job.id,job.leaseToken,error instanceof Error ? error.message.slice(0,500) : '任务处理失败']);
}
export async function getSupportHistory(ticketId: string) {
  const result = await query("SELECT text,diagnosis,jsonb_array_length(images) AS image_count FROM support_bot_jobs WHERE ticket_id=$1 AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 6",[ticketId]);
  return result.rows.reverse().map(row => ({ question:row.text,reply:row.diagnosis?.userReply,imageCount:row.image_count, hasEvidence:Array.isArray(row.diagnosis?.evidence) && row.diagnosis.evidence.length > 0 }));
}
export async function getLatestSupportImages(ticketId: string): Promise<string[]> {
  // Load only the latest attachment set; never serialize base64 into text history.
  // 只读取最近一组截图，避免批量加载历史图片或把 base64 当文字发送给模型。
  const result = await query<{ images: string[] }>("SELECT images FROM support_bot_jobs WHERE ticket_id=$1 AND status='completed' AND jsonb_array_length(images)>0 ORDER BY created_at DESC,id DESC LIMIT 1", [ticketId]);
  return result.rows[0]?.images ?? [];
}
export async function isSupportDeliveryDone(job:SupportJob,step:string) {
  const result=await query('SELECT 1 FROM support_bot_delivery WHERE job_id=$1 AND step=$2',[job.id,step]);
  return !!result.rowCount;
}
export async function markSupportDeliveryDone(job:SupportJob,step:string) {
  await query('INSERT INTO support_bot_delivery(job_id,step) VALUES($1,$2) ON CONFLICT DO NOTHING',[job.id,step]);
}

export async function assertSupportLease(job:SupportJob) {
  const result=await query("SELECT 1 FROM support_bot_jobs WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now()",[job.id,job.leaseToken]);
  if (!result.rowCount) throw new Error('任务租约已失效');
}


export const supportStages: Record<string, string> = {
  queued: '已收到，等待排查', understanding: '正在结合文字、截图和追问理解问题',
  runtime: '正在核对运行版本与源码来源', data: '正在核对当前账号的相关操作记录',
  trace: '正在沿任务、requestId 与 traceId 展开实际请求链路',
  code: '正在检索相关源码与实现', analysis: '正在核对实际请求链路、错误与运行实现',
  retrying: '本轮暂未完成，等待自动重试', completed: '排查完成', cancelled: '已终止排查，可修改描述后重新发送',
};
export async function updateSupportStage(job: SupportJob, stage: string) {
  if (!Object.hasOwn(supportStages, stage)) throw new Error('无效调查阶段');
  const result = await query("UPDATE support_bot_jobs SET stage=$3,lease_until=now()+interval '15 minutes' WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now() RETURNING id", [job.id,job.leaseToken,stage]);
  if (!result.rowCount) throw new Error('诊断任务租约已失效');
}

export async function appendSupportProgress(job: SupportJob, text: string) {
  const event = { id: randomUUID(), text: text.slice(0, 1000), at: new Date().toISOString() };
  // Persist only public evidence summaries; leases prevent stale workers from publishing.
  // 只持久化可公开的取证摘要；租约防止失效 worker 继续推送。
  const result = await query(`UPDATE support_bot_jobs SET progress=(
    SELECT COALESCE(jsonb_agg(item ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(progress || $3::jsonb) WITH ORDINALITY AS entries(item, position)
    WHERE position > jsonb_array_length(progress) - 63
  ) WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now() RETURNING id`, [job.id, job.leaseToken, JSON.stringify([event])]);
  if (!result.rowCount) throw new Error('诊断任务租约已失效');
}
