import { createHash, timingSafeEqual } from 'node:crypto';
import { AESCipher, Client, LoggerLevel, defaultHttpInstance } from '@larksuiteoapi/node-sdk';
import { assertSupportLease, isSupportDeliveryDone, markSupportDeliveryDone, type DiagnosisResult, type SupportJob, type SupportMessage } from './store';
import { redactSupportText, scrubSupportValue } from './redact';
import { logServerEvent } from '@/lib/observability/server-log';

// Bound each delivery call so an unavailable API cannot outlive the worker lease.
// 限定单次外发耗时，避免飞书不可用时请求超过任务租约。
defaultHttpInstance.defaults.timeout = 15000;
defaultHttpInstance.defaults.maxRedirects = 0;
defaultHttpInstance.defaults.maxContentLength = 2_000_000;

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function supportBotEnabled() { return process.env.SUPPORT_BOT_ENABLED === 'true'; }
export function supportBotSendingEnabled() { return process.env.SUPPORT_BOT_SEND_ENABLED === 'true'; }
export function verifyWorkerToken(value: string) {
  const token = process.env.SUPPORT_BOT_WORKER_TOKEN;
  return Boolean(token && equalSecret(value, `Bearer ${token}`));
}

export function parseFeishuEvent(rawBody: string, headers: Headers): { challenge?: string; message?: SupportMessage } {
  const verificationToken = process.env.FEISHU_SUPPORT_VERIFICATION_TOKEN;
  if (!verificationToken) throw new Error('机器人事件校验未配置');
  const encryptKey = process.env.FEISHU_SUPPORT_ENCRYPT_KEY;
  let payload = JSON.parse(rawBody);
  if (payload.encrypt) {
    if (!encryptKey || typeof payload.encrypt !== 'string') throw new Error('事件加密配置无效');
    payload = JSON.parse(new AESCipher(encryptKey).decrypt(payload.encrypt));
  }
  const token = payload.header?.token || payload.token;
  if (typeof token !== 'string' || !equalSecret(token, verificationToken)) throw new Error('事件校验失败');
  if (payload.type === 'url_verification' && typeof payload.challenge === 'string') return { challenge: payload.challenge };
  // Verify original bytes for events; URL challenge uses the verified token above.
  // 普通事件校验原始字节；URL 校验按官方 SDK 使用已验证 Token。
  if (encryptKey) {
    const timestamp = headers.get('x-lark-request-timestamp') || '';
    const nonce = headers.get('x-lark-request-nonce') || '';
    const signature = headers.get('x-lark-signature') || '';
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce) throw new Error('事件签名无效');
    const expected = createHash('sha256').update(timestamp + nonce + encryptKey + rawBody).digest('hex');
    if (!equalSecret(signature, expected)) throw new Error('事件签名无效');
  }
  const metadata = {
    service: 'support-bot', eventType: payload.header?.event_type,
    senderType: payload.event?.sender?.sender_type,
    messageType: payload.event?.message?.message_type,
    chatType: payload.event?.message?.chat_type,
  };
  // Log only protocol metadata so ignored events can be diagnosed without exposing messages.
  // 只记录协议元数据，既能定位静默忽略的事件，也不暴露消息正文和凭据。
  function ignore(reason: string) {
    logServerEvent('support_bot_event_ignored', { ...metadata, reason });
    return {};
  }
  if (payload.header?.event_type !== 'im.message.receive_v1') return ignore('unsupported_event_type');
  if (payload.header.app_id !== process.env.FEISHU_SUPPORT_APP_ID) throw new Error('应用不匹配');
  const tenantKey = process.env.FEISHU_SUPPORT_TENANT_KEY;
  if (tenantKey && payload.header.tenant_key !== tenantKey) throw new Error('租户不匹配');
  const { sender, message } = payload.event || {};
  logServerEvent('support_bot_event_received', metadata);
  if (sender?.sender_type !== 'user') return ignore('unsupported_sender_type');
  if (message?.message_type !== 'text') return ignore('unsupported_message_type');
  const botOpenId = process.env.FEISHU_SUPPORT_BOT_OPEN_ID;
  const mentioned = botOpenId && message.mentions?.some((item: { id?: { open_id?: string } }) => item.id?.open_id === botOpenId);
  if (message.chat_type !== 'p2p' && !(message.chat_type === 'group' && mentioned)) return ignore('not_private_or_bot_mention');
  const content = JSON.parse(message.content);
  if (typeof content.text !== 'string') return ignore('missing_text');
  let text = content.text;
  for (const mention of message.mentions || []) {
    if (mention.id?.open_id === botOpenId && typeof mention.key === 'string') text = text.split(mention.key).join('');
  }
  text = text.trim();
  const openId = sender.sender_id?.open_id;
  if (!text || text.length > 8000) return ignore('empty_or_oversized_text');
  if (!openId || !message.message_id || !message.chat_id || !payload.header.event_id) return ignore('missing_message_identifiers');
  const isGroup = message.chat_type === 'group';
  // Use the root message as the conversation key so follow-ups stay in one topic.
  // 群聊首条消息以自身作为主题根，后续回复沿用同一个根消息 ID。
  const threadId = isGroup ? message.root_id || message.message_id : undefined;
  return { message: { eventId: payload.header.event_id, messageId: message.message_id, chatId: message.chat_id, openId, text, isGroup, threadId } };
}

function client() {
  if (!supportBotSendingEnabled()) throw new Error('机器人发送尚未启用');
  const appId = process.env.FEISHU_SUPPORT_APP_ID;
  const appSecret = process.env.FEISHU_SUPPORT_APP_SECRET;
  if (!appId || !appSecret) throw new Error('机器人应用凭据未配置');
  return new Client({ appId, appSecret, loggerLevel: LoggerLevel.error });
}
function checkResponse(response: { code?: number; msg?: string }) {
  if (response.code !== 0) throw new Error(`飞书 API 调用失败 (${response.code ?? 'unknown'})`);
}
export async function replyToMessage(messageId: string, text: string, uuid?: string, replyInThread = false) {
  const response = await client().im.message.reply({ path: { message_id: messageId }, data: { content: JSON.stringify({ text: redactSupportText(text) }), msg_type: 'text', uuid, ...(replyInThread ? { reply_in_thread: true } : {}) } });
  checkResponse(response);
}

export async function deliverSupportResult(job: SupportJob, result: DiagnosisResult) {
  const sdk = client();
  const failures: Error[] = [];
  // Keep successful channels durable while retrying failed ones independently.
  // 各通道独立持久化成功状态，表格故障不能阻断回复和负责人通知。
  async function deliver(step: string, action: () => Promise<void | false>) {
    try {
      if (await isSupportDeliveryDone(job, step)) return;
      await assertSupportLease(job);
      if (await action() === false) return;
      await markSupportDeliveryDone(job, step);
    } catch (error) {
      failures.push(new Error(`机器人 ${step} 投递失败`, { cause: error }));
    }
  }
  await deliver('reply', async () => {
    const replyTarget = job.isGroup && job.threadId ? job.threadId : job.messageId;
    await replyToMessage(replyTarget, `问题编号：${job.ticketId}\n${result.userReply}`, createHash('sha256').update(`reply:${job.id}`).digest('hex').slice(0, 32), job.isGroup);
  });
  if (!result.guidanceOnly) {
    await deliver('table', () => syncSupportTable(sdk, job, result));
    if (result.needsDeveloper) await deliver('owner', () => notifySupportOwner(sdk, job, result));
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('；'));
}

async function syncSupportTable(sdk: Client, job: SupportJob, result: DiagnosisResult) {
  const appToken = process.env.FEISHU_SUPPORT_BITABLE_APP_TOKEN;
  const tableId = process.env.FEISHU_SUPPORT_BITABLE_TABLE_ID;
  if (Boolean(appToken) !== Boolean(tableId)) throw new Error('问题表配置不完整');
  if (appToken && tableId) {
    const path = { app_token: appToken, table_id: tableId };
    const existing = await sdk.bitable.appTableRecord.search({ path, data: { filter: { conjunction: 'and', conditions: [{ field_name: '问题编号', operator: 'is', value: [job.ticketId] }] } } });
    checkResponse(existing);
    const fields: Record<string, string> = result.closed
      ? { '问题编号': job.ticketId, '状态': '已关闭' }
      : { '问题编号': job.ticketId, '问题描述': redactSupportText(job.text), '诊断摘要': redactSupportText(result.internalSummary), '模块': redactSupportText(result.module), '状态': result.needsDeveloper ? '待开发处理' : '已回复', '用户ID': job.openId, '消息ID': job.messageId, '证据摘要': JSON.stringify(scrubSupportValue(result.evidence)).slice(0, 6000) };
    const recordId = existing.data?.items?.[0]?.record_id;
    await assertSupportLease(job);
    const response = recordId
      ? await sdk.bitable.appTableRecord.update({ path: { ...path, record_id: recordId }, data: { fields } })
      : await sdk.bitable.appTableRecord.create({ path, data: { fields } });
    checkResponse(response);
    return;
  }
  return false as const;
}

async function notifySupportOwner(sdk: Client, job: SupportJob, result: DiagnosisResult) {
  const owners: Record<string, string> = JSON.parse(process.env.SUPPORT_BOT_MODULE_OWNERS || '{}');
  if (!owners || typeof owners !== 'object' || Array.isArray(owners)) throw new Error('模块负责人配置无效');
  const owner = Object.hasOwn(owners, result.module) ? owners[result.module] : owners.default;
  if (typeof owner !== 'string' || !owner.startsWith('ou_')) return false as const;
  await assertSupportLease(job);
  const response = await sdk.im.message.create({ params: { receive_id_type: 'open_id' }, data: { receive_id: owner, msg_type: 'text', uuid: createHash('sha256').update(`owner:${job.id}`).digest('hex').slice(0, 32), content: JSON.stringify({ text: `问题 ${job.ticketId}\n模块：${redactSupportText(result.module)}\n${redactSupportText(result.internalSummary)}` }) } });
  checkResponse(response);
}
