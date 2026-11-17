import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream';

const unavailable = '独立工作台的问题助手尚未就绪；不会向旧主站发送问题。';
function configuration() {
  const token = process.env.SUPPORT_BOT_WEB_RELAY_TOKEN || '';
  if (token.length < 32) return null;
  try {
    const url = new URL(process.env.SUPPORT_BOT_WEB_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return { url, token };
  } catch { return null; }
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
  res.end(JSON.stringify(value));
}

export async function nativeSupportWebRoute(req, res, { actor, path, authenticate }) {
  if (!['/api/support-bot/status', '/api/support-bot/web'].includes(path.pathname)) return false;
  const config = configuration();
  if (path.pathname === '/api/support-bot/status') {
    if (req.method !== 'GET') { json(res, 405, { error: '请求方法不支持' }); return true; }
    let enabled = false;
    if (config) {
      try {
        const response = await fetch(new URL('/health/ready', config.url), { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
        enabled = response.ok && (await response.json()).enabled === true;
      } catch { /* Missing or unhealthy intake must not unlock the UI. / 未就绪的接入不能解锁界面。 */ }
    }
    json(res, 200, { enabled });
    return true;
  }
  if (!config) { json(res, 503, { error: unavailable, reason: 'NATIVE_SUPPORT_UNAVAILABLE' }); return true; }
  if (!['GET', 'POST'].includes(req.method)) { json(res, 405, { error: '请求方法不支持' }); return true; }
  const expectations = [req.headers['x-canvas-expected-user'], ...path.searchParams.getAll('expectedUserId')];
  if (expectations.some(expected => expected && expected !== actor.id)) { json(res, 403, { error: '账号已切换，请重新打开当前页面' }); return true; }
  const headers = { authorization: `Bearer ${config.token}`, 'x-fg-support-user': actor.id };
  for (const name of ['content-type', 'content-length', 'accept']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
  const upstream = (config.url.protocol === 'https:' ? https : http).request(new URL(path.pathname + path.search, config.url), { method: req.method, headers });
  let timer;
  const stop = () => clearInterval(timer);
  upstream.on('response', remote => {
    const responseHeaders = Object.fromEntries(['content-type', 'cache-control', 'x-accel-buffering', 'x-content-type-options', 'x-fg-trace-id'].filter(name => remote.headers[name]).map(name => [name, remote.headers[name]]));
    res.writeHead(remote.statusCode || 503, responseHeaders);
    if (String(remote.headers['content-type']).startsWith('text/event-stream')) {
      let checking = false;
      // An open stream must not outlive the Go session that authorized it.
      // 流式连接不能在授权它的 Go 会话失效后继续读取。
      timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const current = await authenticate(req);
          if (!current || current.id !== actor.id) { upstream.destroy(); remote.destroy(); res.end(); }
        } catch { upstream.destroy(); remote.destroy(); res.end(); }
        finally { checking = false; }
      }, 15000);
      timer.unref();
    }
    remote.once('end', stop);
    pipeline(remote, res, stop);
  });
  upstream.setTimeout(75000, () => upstream.destroy(new Error('SUPPORT_WEB_TIMEOUT')));
  upstream.on('error', () => { stop(); if (res.headersSent) res.destroy(); else json(res, 503, { error: unavailable }); });
  res.once('close', () => { stop(); upstream.destroy(); });
  pipeline(req, upstream, () => {});
  return true;
}
