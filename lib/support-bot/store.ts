import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '@/lib/local/db';

export type SupportMessage = { eventId: string; messageId: string; chatId: string; openId: string; text: string; threadId?: string; isGroup?: boolean };
export type DiagnosisResult = { userReply: string; internalSummary: string; needsDeveloper: boolean; module: string; evidence: unknown[]; guidanceOnly?: boolean; closed?: boolean };
export type SupportJob = SupportMessage & { id: string; ticketId: string; attempts: number; leaseToken: string; diagnosis: DiagnosisResult | null };
let schemaReady: Promise<void> | undefined;
export function ensureSupportSchema() {
  schemaReady ??= query('SELECT 1 FROM support_bot_jobs LIMIT 0').then(() => undefined).catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}
export async function enqueueSupportMessage(message: SupportMessage) {
  await ensureSupportSchema();
  if (!message.text.trim() || message.text.length > 8000) throw new Error('问题内容需为 1 到 8000 字符');
  return withTransaction(async (db) => {
    // Serialize a conversation, including duplicate callbacks, across workers.
    // 按会话加事务锁，避免回调重试及并发续问创建重复工单。
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${message.openId}:${message.chatId}:${message.threadId || ''}`]);
    const previous = await db.query('SELECT ticket_id FROM support_bot_jobs WHERE event_id=$1 OR message_id=$2', [message.eventId,message.messageId]);
    if (previous.rows[0]) return { ticketId: previous.rows[0].ticket_id as string, duplicate: true };
    const pressure=await db.query("SELECT count(*) FILTER(WHERE j.created_at>now()-interval '1 minute')::int recent,count(*) FILTER(WHERE j.status IN ('pending','processing'))::int queued FROM support_bot_jobs j JOIN support_bot_tickets t ON t.id=j.ticket_id WHERE t.open_id=$1",[message.openId]);
    if (pressure.rows[0].recent>=5 || pressure.rows[0].queued>=10) throw new Error('提问过于频繁，请稍后重试');
    if (message.text.trim()==='新问题') await db.query("UPDATE support_bot_tickets SET status='closed' WHERE open_id=$1 AND chat_id=$2 AND thread_id=$3",[message.openId,message.chatId,message.threadId || '']);
    const existing = await db.query("SELECT id FROM support_bot_tickets WHERE open_id=$1 AND chat_id=$2 AND thread_id=$3 AND status='open' AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1", [message.openId,message.chatId,message.threadId || '']);
    const ticketId = existing.rows[0]?.id || randomUUID();
    await db.query('INSERT INTO support_bot_tickets(id,open_id,chat_id,thread_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET updated_at=now()', [ticketId,message.openId,message.chatId,message.threadId || '']);
    await db.query('INSERT INTO support_bot_jobs(id,event_id,message_id,ticket_id,text,is_group) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),message.eventId,message.messageId,ticketId,message.text,!!message.isGroup]);
    if (message.text.trim()==='关闭问题') await db.query("UPDATE support_bot_tickets SET status='closed' WHERE id=$1",[ticketId]);
    return { ticketId: ticketId as string, duplicate: false };
  });
}
export async function claimSupportJob(): Promise<SupportJob | null> {
  await ensureSupportSchema();
  await query("UPDATE support_bot_jobs SET status='failed',error='任务租约过期且重试已用尽' WHERE status='processing' AND lease_until<now() AND attempts>=4");
  const token = randomUUID();
  const result = await query(`WITH candidate AS (
    SELECT j.id FROM support_bot_jobs j WHERE ((j.status='pending' AND j.available_at<=now()) OR (j.status='processing' AND j.lease_until<now())) AND j.attempts<4 AND NOT EXISTS(SELECT 1 FROM support_bot_jobs active WHERE active.ticket_id=j.ticket_id AND active.id<>j.id AND active.status='processing' AND active.lease_until>now())
    AND NOT EXISTS(SELECT 1 FROM support_bot_jobs earlier WHERE earlier.ticket_id=j.ticket_id AND (earlier.created_at,earlier.id)<(j.created_at,j.id) AND earlier.status IN ('pending','processing'))
    ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (UPDATE support_bot_jobs j SET status='processing',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '15 minutes' FROM candidate WHERE j.id=candidate.id RETURNING j.*)
  SELECT claimed.*,t.open_id,t.chat_id,t.thread_id FROM claimed JOIN support_bot_tickets t ON t.id=claimed.ticket_id`,[token]);
  const row = result.rows[0];
  return row ? { id:row.id,ticketId:row.ticket_id,eventId:row.event_id,messageId:row.message_id,openId:row.open_id,chatId:row.chat_id,threadId:row.thread_id,text:row.text,attempts:row.attempts,leaseToken:token,diagnosis:row.diagnosis,isGroup:row.is_group } : null;
}
export async function saveSupportDiagnosis(job: SupportJob, result: DiagnosisResult) {
  const saved = await query("UPDATE support_bot_jobs SET diagnosis=$3::jsonb WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now() RETURNING id",[job.id,job.leaseToken,JSON.stringify(result)]);
  if (!saved.rowCount) throw new Error('诊断任务租约已失效');
}
export async function completeSupportJob(job: SupportJob) {
  await query("UPDATE support_bot_jobs SET status='completed',lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2",[job.id,job.leaseToken]);
}
export async function failSupportJob(job: SupportJob, error: unknown) {
  await query("UPDATE support_bot_jobs SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,available_at=now()+interval '1 minute',lease_until=NULL,error=$3 WHERE id=$1 AND lease_token=$2",[job.id,job.leaseToken,error instanceof Error ? error.message.slice(0,500) : '任务处理失败']);
}
export async function getSupportHistory(ticketId: string) {
  const result = await query("SELECT text,diagnosis FROM support_bot_jobs WHERE ticket_id=$1 AND status='completed' ORDER BY created_at DESC LIMIT 6",[ticketId]);
  return result.rows.reverse().map(row => ({ question:row.text,reply:row.diagnosis?.userReply }));
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

