const tokenPattern = /^[0-9a-f]{64}$/i;
const managedAuth = /^\/api\/auth\/(?:login|register|logout|password|email|sms|linuxdo|verification)(?:[/-]|$)/;
const commercial = /^\/api\/(?:wallet|payments|payment|admin\/(?:payments|credit-policy|credit-operations|redemption-codes|redeem-codes|redeem-batches|credit-ledger|billing-orders|settings\/credits))(?:[/-]|$)/;
const hopHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);

export function platformToken(cookie) {
  const matches = String(cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith('fg_session='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice('fg_session='.length);
  return tokenPattern.test(token) ? token : null;
}

export function requestPath(raw, origin) {
  const path = new URL(raw, origin);
  if (path.origin !== origin) throw new Error('INVALID_PATH');
  // Do not let nginx decode an encoded slash into an alternate auth endpoint.
  if (/%(?:2f|5c|25)/i.test(path.pathname)) throw new Error('INVALID_PATH');
  const decoded = decodeURIComponent(path.pathname);
  return { url: path, managedAuth: managedAuth.test(decoded), commercial: commercial.test(decoded) || /^\/api\/admin\/users\/[^/]+\/credits(?:\/|$)/.test(decoded) };
}

export function trustedOrigin(method, origin, allowed) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || allowed.includes(origin);
}

export function publicResourceRead(method, path) {
  return ['GET', 'HEAD'].includes(method) && /^\/api\/public\/resources\/(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/file$/.test(path.pathname);
}

export function proxyHeaders(incoming, cookie, host) {
  const blocked = new Set([...hopHeaders, 'cookie', 'authorization', 'host', 'forwarded']);
  String(incoming.connection || '').split(',').forEach(h => blocked.add(h.trim().toLowerCase()));
  const headers = Object.fromEntries(Object.entries(incoming).filter(([name]) =>
    !blocked.has(name.toLowerCase()) && !/^x-(?:canvas-|yingce-|forwarded-|fg-)/i.test(name)));
  return { ...headers, cookie, host, 'x-forwarded-proto': 'https', 'x-forwarded-host': host };
}

export function responseHeaders(incoming) {
  const blocked = new Set([...hopHeaders, 'set-cookie']);
  String(incoming.connection || '').split(',').forEach(h => blocked.add(h.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(incoming).filter(([name]) => !blocked.has(name.toLowerCase())));
}
