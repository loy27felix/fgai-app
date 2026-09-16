const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestTraceId(request: Request) {
  const incoming = request.headers.get('x-fg-trace-id') || request.headers.get('x-request-id');
  return incoming && TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
}
