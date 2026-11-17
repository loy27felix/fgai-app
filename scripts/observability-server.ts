import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { TransformStream } from 'node:stream/web';
import { closeDb, withTransaction } from '../lib/local/db';
import { GET as monitorGET, POST as monitorPOST } from '../lib/observability/monitor-api';
import { POST as errorPOST } from '../lib/observability/error-api';
import { logServerFailure, redactServerLogText, SERVER_LOG_MAX_BYTES } from '../lib/observability/server-log';

const secret = process.env.FG_OBSERVABILITY_SECRET || '';
if (process.env.FG_RUNTIME_TARGET !== 'native' || !process.env.DATABASE_URL || secret.length < 32) {
  throw new Error('Native observability requires an explicit database and a dedicated secret of at least 32 characters');
}
const digest = (value: string) => createHash('sha256').update(value).digest();
const expected = digest(secret);
const protocol = { runtimeTarget: 'native', monitorHeartbeatProtocol: 1, durableEventAckProtocol: 1 };
// The host producer wraps an already bounded log in an additional JSON envelope.
// 宿主生产端还会为有界日志添加 JSON envelope，不能用原日志上限误拒合法事件。
const maxBodyBytes = 2 * SERVER_LOG_MAX_BYTES;
class BodyTooLarge extends Error {}

async function ready() {
  // Consume the retained reporting schema; never initialize a replacement empty database.
  // 只消费保留的报表 schema，不自动建库建表或用空库替代历史数据。
  await withTransaction(async (client) => {
    await client.query('set transaction read only');
    await client.query("set local statement_timeout = '1500ms'");
    await client.query("set local lock_timeout = '1000ms'");
    await client.query('select observed_at, host, service, check_name, state, previous_state, message, duration_ms, deployment_version, container_id, event_key, metadata from observability_service_events where false');
    await client.query('select occurred_at, source, service, feature, action, severity, impact, fingerprint, code, message, stack, trace_id, request_id, task_id, user_id, route, http_status, deployment_version, event_key, metadata from observability_error_events where false');
    await client.query('select status, data_as_of, error, updated_at, period_end, period_start, summary from report_runs where false');
  });
}

async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function main() {
  await ready();
  const server = http.createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    incoming.once('aborted', () => abort.abort());
    outgoing.once('close', () => abort.abort());
    const json = (status: number, value: unknown) => {
      if (status >= 400 && !incoming.complete) outgoing.setHeader('connection', 'close');
      outgoing.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      outgoing.end(JSON.stringify(value));
    };
    try {
      const received = incoming.headers['x-fg-observability-secret'];
      if (typeof received !== 'string' || !timingSafeEqual(expected, digest(received))) {
        json(404, { error: 'not found' }); return;
      }
      const url = new URL(incoming.url || '/', 'http://observability.internal');
      if (url.pathname === '/health/ready' && incoming.method === 'GET') {
        await ready(); json(200, protocol); return;
      }
      const monitor = url.pathname === '/api/observability/monitor-events';
      const error = url.pathname === '/api/observability/error-events';
      if (!monitor && !error) { json(404, { error: 'not found' }); return; }
      const headers = new Headers({ 'x-fg-observability-secret': secret });
      if (monitor && incoming.method === 'GET') {
        const response = await monitorGET(new Request(url, { headers }));
        json(response.status, response.ok ? protocol : await response.json()); return;
      }
      if (incoming.method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(incoming.headers['content-type'] || '')) {
        json(415, { error: 'application/json is required' }); return;
      }
      if (incoming.headers['content-length']) headers.set('content-length', incoming.headers['content-length']);
      // Preserve the socket long enough to send a real 413 for oversized chunked bodies.
      // 超限时保留 socket 直到发出真实 413，避免 chunked 正文只得到 ECONNRESET。
      const streamed = new Request(url, { method: 'POST', headers, signal: abort.signal,
        body: Readable.toWeb(incoming).pipeThrough(new TransformStream(), { preventCancel: true }), duplex: 'half' } as RequestInit);
      let body: unknown;
      try { body = await readBody(streamed); }
      catch (failure) { json(failure instanceof BodyTooLarge ? 413 : 400, { error: 'invalid or oversized event' }); return; }
      const key = body && typeof body === 'object' && !Array.isArray(body) && 'eventKey' in body ? body.eventKey : undefined;
      if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,240}$/.test(key) || redactServerLogText(key) !== key) {
        json(400, { error: 'a stable eventKey is required' }); return;
      }
      if (error) {
        const event = body as Record<string, unknown>;
        if (event.occurredAt !== undefined && (typeof event.occurredAt !== 'string' || Number.isNaN(new Date(event.occurredAt).getTime()))) {
          json(400, { error: 'occurredAt must be a valid timestamp' }); return;
        }
        if (typeof event.userId === 'string' && /^[a-f0-9]{32}$/i.test(event.userId)) {
          // Retained report user_id is UUID; preserve the native identity without rewriting namespaces.
          // 保留报表的 user_id 是 UUID；原生身份原样存入 metadata，不转换成另一账号命名空间。
          const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
            ? event.metadata : { originalMetadata: event.metadata };
          event.metadata = { ...metadata, nativeUserId: event.userId };
        }
      }
      const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: abort.signal });
      const response = await (monitor ? monitorPOST : errorPOST)(request);
      const value = await response.json() as { ok?: boolean };
      // The shared handler resolves only after the original DB transaction commits.
      // 共用 handler 只在原数据库事务提交后返回；失败或断连不伪造持久确认。
      json(response.status, response.ok && value.ok === true ? { ok: true, eventKey: key, ...protocol } : value);
    } catch (failure) {
      if (abort.signal.aborted) return;
      logServerFailure('native_observability_request_failed', failure);
      if (outgoing.headersSent) outgoing.destroy();
      else json(503, { error: 'observability unavailable' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.FG_OBSERVABILITY_PORT || 3013), process.env.FG_OBSERVABILITY_HOST || '0.0.0.0');
  const shutdown = () => { server.close(() => { void closeDb(); }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
void main().catch((failure) => {
  logServerFailure('native_observability_start_failed', failure);
  process.exitCode = 1;
  void closeDb();
});
