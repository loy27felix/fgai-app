/**
 * Small, dependency-free structured logger for server-side feature work.
 *
 * It writes JSON lines so Docker, `pnpm logs:app`, and any later log collector
 * can filter the same fields. Logging is deliberately best-effort: tracing a
 * failure must never create a second user-facing failure.
 */
export type ServerLogLevel = 'info' | 'warn' | 'error';
export type ServerLogFields = Record<string, unknown>;
type SafeLogValue = string | number | boolean | null | undefined | SafeLogValue[] | { [key: string]: SafeLogValue };

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|token|secret|password|api[_-]?key|access[_-]?key|signature|sig)$/i;
const TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function redactServerLogText(value: unknown) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/data:[^;,\s]+(?:;[^,\s]+)*,\S{32,}/gi, 'data:[redacted]')
    .replace(/((?:token|signature|sig|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** Format the human-facing timestamp in the server's operating timezone.
 * 服务日志使用中国时区展示，另外保留 UTC 时间供机器检索和跨时区对账。
 */
export function formatServerLogTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function serialiseLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): SafeLogValue {
  if (typeof value === 'string') return redactServerLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
  if (value instanceof Error) return serialiseLogError(value, depth, seen);
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => serialiseLogValue(item, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const serialised: Record<string, SafeLogValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      serialised[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : serialiseLogValue(item, depth + 1, seen);
    }
    return serialised;
  }
  return redactServerLogText(value);
}

export function serialiseLogError(error: unknown, depth = 0, seen = new WeakSet<object>()): SafeLogValue {
  if (error instanceof Error) {
    const value = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
    return {
      name: value.name,
      message: redactServerLogText(value.message) || 'unknown error',
      ...(typeof value.code === 'string' || typeof value.code === 'number' ? { code: value.code } : {}),
      ...(typeof value.status === 'number' ? { status: value.status } : {}),
      ...(depth === 0 && value.cause !== undefined ? { cause: serialiseLogError(value.cause, depth + 1, seen) } : {}),
    };
  }
  return serialiseLogValue(error, depth, seen);
}

export function requestTraceId(request: Request) {
  const incoming = request.headers.get('x-fg-trace-id') || request.headers.get('x-request-id');
  return incoming && TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
}

export function attachTraceId<T extends Response>(response: T, traceId: string): T {
  response.headers.set('x-fg-trace-id', traceId);
  return response;
}

export function logServerEvent(
  event: string,
  fields: ServerLogFields = {},
  level: ServerLogLevel = 'info',
) {
  try {
    const now = new Date();
    const line = JSON.stringify(serialiseLogValue({
      event,
      timestamp: formatServerLogTime(now),
      timestampUtc: now.toISOString(),
      ...fields,
    }));
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  } catch {
    // Never let diagnostics break a generation or a chat response.
    try { console.error('{"event":"logging_failure","stage":"serialisation"}'); } catch { /* noop */ }
  }
}

export function logServerFailure(event: string, error: unknown, fields: ServerLogFields = {}) {
  logServerEvent(event, { ...fields, error: serialiseLogError(error) }, 'error');
}
