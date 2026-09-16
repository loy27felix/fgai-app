const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const REQUEST_EVENT_PATH = '/api/observability/request-events';
const INTERNAL_REQUEST_EVENT_URL = process.env.NODE_ENV === 'production'
  ? `http://app:3000${REQUEST_EVENT_PATH}`
  : `http://127.0.0.1:3000${REQUEST_EVENT_PATH}`;

export function requestTraceId(request: Request) {
  const incoming = request.headers.get('x-fg-trace-id') || request.headers.get('x-request-id');
  return incoming && TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
}

/** Queue compact request audit metadata without delaying the business response.
 * 异步写入紧凑请求审计元数据，不延迟业务响应。
 */
export function queueEdgeRequestEvent(request: Request, traceId: string) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === REQUEST_EVENT_PATH) return null;
  if (request.method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/admin')) return null;

  const secret = process.env.FG_OBSERVABILITY_SECRET || process.env.SESSION_SECRET || '';
  if (!secret) return null;

  const payload = {
    traceId,
    method: request.method,
    path,
    host: request.headers.get('host') || undefined,
    origin: request.headers.get('origin') || undefined,
    forwardedHost: request.headers.get('x-forwarded-host') || undefined,
    forwardedPort: request.headers.get('x-forwarded-port') || undefined,
    forwardedProto: request.headers.get('x-forwarded-proto') || undefined,
    requestId: request.headers.get('x-request-id') || undefined,
    nextAction: request.headers.get('next-action') || undefined,
    contentType: request.headers.get('content-type') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
    cfRay: request.headers.get('cf-ray') || undefined,
  };

  return fetch(INTERNAL_REQUEST_EVENT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fg-observability-secret': secret,
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}
