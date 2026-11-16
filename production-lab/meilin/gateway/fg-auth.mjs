import http from 'node:http';
import { pipeline } from 'node:stream';
import { proxyHeaders, responseHeaders } from './policy.mjs';

const sessionName = 'open_ai_canvas_session';
const userID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const publicPages = new Set(['/', '/index.html', '/login', '/register', '/forgot-password', '/logo.svg', '/favicon.ico', '/favicon.svg', '/manifest.webmanifest', '/.well-known/fg-runtime.json']);
const publicReads = new Set(['/api/auth/settings', '/api/auth/session', '/api/auth/linuxdo/start', '/api/auth/linuxdo/callback', '/api/oauth/linuxdo/callback', '/oauth/linuxdo/callback', '/api/public/appearance']);
const publicWrites = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/register', '/api/auth/email-code', '/api/auth/password-reset-code', '/api/auth/password-reset', '/api/auth/verification', '/api/auth/verification/login']);

export function workspaceAuthMode(value = process.env.FG_AUTH_MODE || 'platform') {
  if (value !== 'platform' && value !== 'native') throw new Error('INVALID_FG_AUTH_MODE');
  return value;
}

export function nativeSessionCookie(value) {
  const cookies = String(value || '').split(';').map(part => part.trim()).filter(part => part.startsWith(sessionName + '='));
  if (cookies.length !== 1) return '';
  const token = cookies[0].slice(sessionName.length + 1);
  const [id, secret, extra] = token.split('.');
  return userID.test(id || '') && /^[0-9a-f]{64}$/i.test(secret || '') && extra === undefined ? `${sessionName}=${token}` : '';
}

export function nativePublicRequest(method, path) {
  if (method === 'POST') return publicWrites.has(path.pathname);
  if (method !== 'GET' && method !== 'HEAD') return false;
  return publicPages.has(path.pathname) || publicReads.has(path.pathname)
    || /^\/api\/public\/appearance\/(?:assets\/[a-z0-9_-]+|updates\/[a-zA-Z0-9_-]+)$/.test(path.pathname)
    || /^\/(?:assets|fonts)\/[a-zA-Z0-9_.~-]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|webp|ico|gif|jpe?g|avif|wasm)$/.test(path.pathname);
}

export function nativePageRequest(req, path) {
  return ['GET', 'HEAD'].includes(req.method) && String(req.headers.accept || '').includes('text/html')
    && !/^\/(?:api(?:\/|$)|assets\/|fonts\/|\.well-known(?:\/|$))/.test(path.pathname);
}

export function nativeResponseHeaders(incoming) {
  const headers = responseHeaders(incoming);
  const cookies = Array.isArray(incoming['set-cookie']) ? incoming['set-cookie'] : [incoming['set-cookie']];
  const sessionCookies = cookies.filter(value => typeof value === 'string' && value.startsWith(sessionName + '='));
  if (sessionCookies.length) headers['set-cookie'] = sessionCookies;
  return headers;
}

export async function nativeActor(req, { pool, web, publicOrigin }) {
  const cookie = nativeSessionCookie(req.headers.cookie);
  if (!cookie) return null;
  const headers = proxyHeaders({}, cookie, new URL(publicOrigin).host);
  headers['x-forwarded-proto'] = new URL(publicOrigin).protocol.slice(0, -1);
  const response = await fetch(new URL('/api/auth/session', web), { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('NATIVE_AUTH_UNAVAILABLE');
  const data = await response.json();
  if (data.code !== 0) throw new Error('NATIVE_AUTH_UNAVAILABLE');
  const user = data.data?.user;
  if (!user) return null;
  if (!userID.test(user.id || '')) throw new Error('INVALID_NATIVE_IDENTITY');
  // Roles and disabled state remain owned by the native backend, never by stale FG mappings.
  // 角色和禁用状态以原生账户为准，不能由旧 FG 映射恢复权限。
  const account = (await pool.query(`SELECT u.id,u.email,u.display_name,u.role,u.status,a.platform_role
    FROM users u LEFT JOIN fg_accounts a ON a.user_id=u.id WHERE u.id=$1`, [user.id])).rows[0];
  if (!account || account.status !== 'active') return null;
  if (!['admin', 'user'].includes(account.role)) throw new Error('INVALID_NATIVE_ROLE');
  // Preserve non-privileged legacy labels used by canvas visibility; they can never grant reviewer rights.
  // 保留画布可见性使用的旧低权限标签；审核权限仍只能来自 Go 管理员角色。
  const platformRole = account.role === 'admin' ? 'superadmin' : ['user', 'member', 'admin'].includes(account.platform_role) ? account.platform_role : 'user';
  await pool.query(`INSERT INTO fg_accounts(user_id,email,platform_role) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,platform_role=excluded.platform_role
    WHERE fg_accounts.email IS DISTINCT FROM excluded.email OR fg_accounts.platform_role IS DISTINCT FROM excluded.platform_role`,
    [account.id, account.email || '', platformRole]);
  return { id: account.id, email: account.email || '', name: account.display_name || user.username, reviewer: account.role === 'admin', platformRole };
}

export function proxyNativeRequest(req, res, { path, web, publicOrigin }) {
  const headers = proxyHeaders(req.headers, nativeSessionCookie(req.headers.cookie), new URL(publicOrigin).host);
  headers['x-forwarded-proto'] = new URL(publicOrigin).protocol.slice(0, -1);
  if (req.headers.origin) headers.origin = publicOrigin;
  const upstream = http.request(new URL(path.pathname + path.search, web), { method: req.method, headers }, remote => {
    const outgoing = nativeResponseHeaders(remote.headers);
    if (!/^\/(?:assets|fonts)\//.test(path.pathname)) outgoing['cache-control'] = 'no-store';
    res.writeHead(remote.statusCode || 502, outgoing);
    pipeline(remote, res, () => {});
  });
  upstream.setTimeout(30000, () => upstream.destroy(new Error('NATIVE_AUTH_TIMEOUT')));
  upstream.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ code: 503, data: null, msg: '工作台登录服务暂时不可用，请稍后重试', reason: 'NATIVE_AUTH_UNAVAILABLE' }));
  });
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  pipeline(req, upstream, () => {});
}
