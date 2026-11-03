import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream';

// Only these GETs use the read credential; all business requests keep existing auth.
// 仅这些 GET 使用只读凭据，业务请求继续走原有鉴权。
export function forwardNativeSupport(req, res, connection, capability) {
  const path = req.url?.split('?')[0];
  if (!['/internal/support/evidence', '/internal/support/version'].includes(path)) return false;
  const token = process.env.SUPPORT_BOT_NATIVE_READ_TOKEN;
  const supplied = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token ?? ''}`);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json');
  const enabled = token && token.trim().length >= 32 && token === token.trim()
    && token !== capability && token !== connection?.token;
  if (!enabled || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } })); return true;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' }); res.end(JSON.stringify({ error: { code: 'READ_ONLY' } })); return true;
  }
  if (!connection) {
    res.writeHead(503); res.end(JSON.stringify({ error: { code: 'DAEMON_UNAVAILABLE' } })); return true;
  }
  // Do not replace the native token with the daemon's writable business token.
  // 不得把原生只读 token 替换成 daemon 的业务写入 token。
  const upstream = http.request(new URL(req.url, connection.address), {
    method: 'GET', headers: { authorization: req.headers.authorization }, timeout: 10_000
  }, remote => {
    res.writeHead(remote.statusCode ?? 502, remote.headers);
    pipeline(remote, res, () => {});
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503); res.end(JSON.stringify({ error: { code: 'DAEMON_UNAVAILABLE' } }));
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  upstream.end();
  return true;
}

// Preserve only daemon-owned metadata, even if another stdout producer adds fields.
// 即使其他 stdout 来源附加字段，也只保留当前实例 daemon 的元数据白名单。
export function writeNativeSupportLog(record, actor) {
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
  const isoTime = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
  if (record.event !== 'support_http_request' || record.service !== 'opencreator'
    || record.actor_id !== actor || !safeId(record.actor_id) || !safeId(record.request_id)
    || ['project_id', 'task_id', 'trace_id'].some(key => Object.hasOwn(record, key) && !safeId(record[key]))
    || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(record.method)
    || !Number.isInteger(record.http_status) || record.http_status < 100 || record.http_status > 599
    || typeof record.route !== 'string' || !/^\/[^\s?#]{0,255}$/.test(record.route)
    || typeof record.build_commit !== 'string' || !/^[a-f0-9]{7,40}$/i.test(record.build_commit)
    || typeof record.build_dirty !== 'boolean' || !isoTime(record.timestamp)
    || (Object.hasOwn(record, 'build_time') && !isoTime(record.build_time))
    || typeof record.build_environment !== 'string' || !/^[A-Za-z0-9_.:+-]{1,128}$/.test(record.build_environment)
    || !Number.isInteger(record.duration_ms) || record.duration_ms < 0) return;
  const fields = ['event', 'timestamp', 'service', 'actor_id', 'request_id', 'method', 'route',
    'http_status', 'duration_ms', 'project_id', 'task_id', 'build_commit', 'build_environment', 'build_dirty', 'build_time'];
  const selected = Object.fromEntries(fields.filter(key => Object.hasOwn(record, key))
    .map(key => [key, record[key]]));
  process.stdout.write(`${JSON.stringify(selected)}\n`);
}
