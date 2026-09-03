export type ClientLogLevel = 'info' | 'warning' | 'error';
export type ClientLogFields = Record<string, unknown>;

function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 1_000);
  if (value instanceof Error) {
    return {
      name: value.name.slice(0, 160),
      message: value.message.slice(0, 1_000),
      ...(value.stack ? { stack: value.stack.slice(0, 2_000) } : {}),
    };
  }
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [key.slice(0, 120), safeValue(item, depth + 1, seen)]),
    );
  }
  return String(value).slice(0, 1_000);
}

function eventId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Send a browser diagnostic event through the existing best-effort telemetry path.
 * 将浏览器诊断事件送入现有尽力观测旁路，不能阻塞或改变正常交互。
 */
export function logClientEvent(event: string, fields: ClientLogFields = {}, severity: ClientLogLevel = 'info') {
  if (typeof window === 'undefined') return;
  try {
    const safeFields = safeValue(fields) as Record<string, unknown>;
    const message = typeof safeFields.message === 'string' && safeFields.message.trim()
      ? safeFields.message
      : event;
    const body = JSON.stringify({
      name: event,
      message,
      route: window.location.pathname,
      severity,
      eventId: eventId(),
      metadata: safeFields,
    });
    void fetch('/api/observability/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body,
      keepalive: true,
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
  } catch {
    // Client diagnostics are strictly best-effort and must never affect UI behavior.
    // 浏览器诊断严格采用尽力策略，任何异常都不能影响页面交互。
  }
}
