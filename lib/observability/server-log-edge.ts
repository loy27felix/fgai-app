export type EdgeServerLogFields = Record<string, unknown>;

const REQUEST_EVENT_PATH = '/api/observability/request-events';
// Docker production resolves the app through Compose DNS because standalone Next may not bind loopback.
// Docker production 使用 Compose DNS 访问 App，因为 standalone Next 可能不会监听容器回环地址。
const INTERNAL_REQUEST_EVENT_URL = process.env.NODE_ENV === 'production'
  ? `http://app:3000${REQUEST_EVENT_PATH}`
  : `http://127.0.0.1:3000${REQUEST_EVENT_PATH}`;

const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestTraceId(request: Request) {
  const incoming = request.headers.get('x-fg-trace-id') || request.headers.get('x-request-id');
  return incoming && TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
}

export function logServerEvent(event: string, fields: EdgeServerLogFields = {}) {
  try {
    console.info(JSON.stringify({ event, timestampUtc: new Date().toISOString(), ...fields }));
  } catch {
    // Edge request tracing must remain non-blocking when a diagnostic value is unusual.
    // Edge 请求追踪遇到异常诊断值时也不能阻断请求。
  }
}

/** Queue request metadata for the Node logger without delaying the response.
 * 将请求元数据异步交给 Node logger，不等待观测请求，避免影响正常业务响应。
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
