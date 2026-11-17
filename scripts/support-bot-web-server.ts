import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { TransformStream } from 'node:stream/web';
import { closeDb } from '../lib/local/db';
import { ensureSupportSchema } from '../lib/support-bot/store';
import { supportWebGET, supportWebPOST } from '../lib/support-bot/web-api';
import { logServerFailure } from '../lib/observability/server-log';
import { isSupportUserId } from '../lib/support-bot/identity';

const token = process.env.SUPPORT_BOT_WEB_RELAY_TOKEN || '';
if (token.length < 32) throw new Error('SUPPORT_BOT_WEB_RELAY_TOKEN must contain at least 32 characters');
const digest = (value: string) => createHash('sha256').update(value).digest();
const expected = digest(`Bearer ${token}`);
const requests = new Set<AbortController>();

async function main() {
  await ensureSupportSchema();
  const server = http.createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    requests.add(abort);
    incoming.once('aborted', () => abort.abort());
    outgoing.once('close', () => { abort.abort(); requests.delete(abort); });
    const json = (status: number, value: unknown) => {
      outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
      outgoing.end(JSON.stringify(value));
    };
    try {
      if (!timingSafeEqual(expected, digest(incoming.headers.authorization || ''))) {
        json(401, { error: '无效的问题助手内部凭据' });
        return;
      }
      const url = new URL(incoming.url || '/', 'http://support-web.internal');
      if (url.pathname === '/health/ready' && incoming.method === 'GET') {
        await ensureSupportSchema();
        json(200, { enabled: process.env.SUPPORT_BOT_ENABLED === 'true' });
        return;
      }
      if (url.pathname !== '/api/support-bot/web') { json(404, { error: '接口不存在' }); return; }
      if (!['GET', 'POST'].includes(incoming.method || '')) { json(405, { error: '请求方法不支持' }); return; }
      const owner = incoming.headers['x-fg-support-user'];
      // Identity comes only from the authenticated private relay, never a body or query parameter.
      // 身份仅来自受认证私网中继，不采纳请求正文或查询参数中的账号。
      if (!isSupportUserId(owner)) { json(401, { error: '问题助手账号无效' }); return; }
      const headers = new Headers();
      for (const name of ['content-type', 'content-length', 'accept', 'x-fg-trace-id']) {
        const value = incoming.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const request = new Request(url, {
        method: incoming.method, headers, signal: abort.signal,
        // Reject oversized bodies without cancelling the socket before the HTTP error is sent.
        // 正文超限时只取消读取，避免发送 HTTP 错误之前销毁底层连接。
        ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming).pipeThrough(new TransformStream(), { preventCancel: true }), duplex: 'half' } : {}),
      } as RequestInit);
      const response = await (incoming.method === 'GET' ? supportWebGET : supportWebPOST)(request, async () => owner);
      if (response.status >= 400 && !incoming.complete) outgoing.setHeader('connection', 'close');
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      abort.signal.addEventListener('abort', () => body.destroy(), { once: true });
      body.once('error', () => outgoing.destroy());
      body.pipe(outgoing);
    } catch (error) {
      if (abort.signal.aborted) return;
      logServerFailure('support_bot_private_web_failed', error, { service: 'support-bot', method: incoming.method });
      if (outgoing.headersSent) outgoing.destroy();
      else json(503, { error: '问题助手暂时无法连接，请稍后重试' });
    }
  });
  server.listen(Number(process.env.SUPPORT_BOT_WEB_PORT || 3012), process.env.SUPPORT_BOT_WEB_HOST || '0.0.0.0');
  const shutdown = () => {
    for (const request of requests) request.abort();
    server.close(() => { void closeDb(); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
void main().catch(() => { console.error('support web intake failed to start'); process.exitCode = 1; void closeDb(); });
