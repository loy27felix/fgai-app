export type EdgeServerLogFields = Record<string, unknown>;

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
