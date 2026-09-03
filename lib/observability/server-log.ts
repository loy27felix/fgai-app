/**
 * Small structured logger for server-side feature work.
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
const PROVIDER_SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|token|secret|password|api[_-]?key|access[_-]?key|signature|credential|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|x-api-key)$/i;
const PROVIDER_SENSITIVE_HEADER = /(?:^|[-_])(authorization|cookie|set-cookie|token|secret|password|api[-_]?key|access[-_]?key|signature|credential)(?:$|[-_])/i;
const PROVIDER_URL_KEY = /(?:url|uri|href)$/i;
const PROVIDER_BINARY_KEY = /(?:base64|binary|buffer|file[_-]?data|image[_-]?data|video[_-]?data)/i;
const FULL_LOG_PAYLOAD = Symbol('full_log_payload');
const FULL_LOG_DEPTH = 10;
const FULL_LOG_ARRAY_ITEMS = 100;
const FULL_LOG_OBJECT_KEYS = 100;
const FULL_LOG_STRING_LENGTH = 16_384;
export const SERVER_LOG_MAX_BYTES = 256 * 1024;
const FULL_LOG_TRUNCATION_MARKER = '[truncated]';

type FullLogPayload = { readonly [FULL_LOG_PAYLOAD]: unknown };
type FullLogBudget = { remaining: number };
type LogSerialiseContext = { fullLogBudget: FullLogBudget };
function fingerprintText(value: string) {
  // Keep the diagnostic fingerprint synchronous and browser-compatible; it is only for correlation, not security.
  // 保持诊断指纹同步且兼容 browser；它只用于关联请求，不承担安全校验。
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Provider exchanges need their complete logical JSON for diagnosis, while
 * credentials and signed URLs must never be written in plaintext.
 * 供应商请求/响应需要保留完整业务 JSON 便于排障，但凭据和签名 URL 绝不能明文落日志。
 */
export function fullLogPayload(value: unknown): FullLogPayload {
  return { [FULL_LOG_PAYLOAD]: value };
}

function isFullLogPayload(value: unknown): value is FullLogPayload {
  return Boolean(value && typeof value === 'object' && FULL_LOG_PAYLOAD in value);
}

export function redactProviderUrl(value: unknown) {
  const raw = String(value ?? '');
  if (!raw) return raw;
  const fingerprint = fingerprintText(raw);
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys()))).sort();
    url.search = queryKeys.map((key) => `${encodeURIComponent(key)}=%5Bredacted%5D`).join('&');
    return `${url.toString()}#fingerprint=${fingerprint}`;
  } catch {
    return `${redactServerLogText(raw, 1_000)}#fingerprint=${fingerprint}`;
  }
}

export function safeProviderHeaders(headers: HeadersInit | undefined) {
  const safe: Record<string, string> = {};
  if (!headers) return safe;
  new Headers(headers).forEach((value, key) => {
    safe[key] = PROVIDER_SENSITIVE_HEADER.test(key) ? '[redacted]' : redactServerLogText(value, 2_000);
  });
  return safe;
}

function serialiseFullLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): SafeLogValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
  if (typeof value === 'string') return redactServerLogText(value, FULL_LOG_STRING_LENGTH);
  if (value instanceof Error) return serialiseLogError(value, depth, seen);
  if (depth >= FULL_LOG_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, FULL_LOG_ARRAY_ITEMS).map((item) => serialiseFullLogValue(item, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const serialised: Record<string, SafeLogValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, FULL_LOG_OBJECT_KEYS)) {
      if (PROVIDER_SENSITIVE_KEY.test(key) || PROVIDER_BINARY_KEY.test(key)) {
        serialised[key] = '[redacted]';
      } else if (PROVIDER_URL_KEY.test(key) && typeof item === 'string') {
        serialised[key] = redactProviderUrl(item);
      } else {
        serialised[key] = serialiseFullLogValue(item, depth + 1, seen);
      }
    }
    return serialised;
  }
  return redactServerLogText(value, FULL_LOG_STRING_LENGTH);
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function jsonByteLength(value: SafeLogValue) {
  const serialised = JSON.stringify(value);
  return serialised === undefined ? 0 : utf8ByteLength(serialised);
}

function fitFullLogString(value: string, budget: FullLogBudget): SafeLogValue {
  const marker = FULL_LOG_TRUNCATION_MARKER;
  if (jsonByteLength(marker) > budget.remaining) {
    budget.remaining = 0;
    return marker;
  }
  let low = 0;
  let high = value.length;
  let best = marker;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${value.slice(0, middle)}${marker}`;
    if (jsonByteLength(candidate) <= budget.remaining) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  budget.remaining = Math.max(0, budget.remaining - jsonByteLength(best));
  return best;
}

function fitFullLogValue(value: SafeLogValue, budget: FullLogBudget): SafeLogValue {
  const fullBytes = jsonByteLength(value);
  if (fullBytes <= budget.remaining) {
    budget.remaining -= fullBytes;
    return value;
  }
  if (typeof value === 'string') return fitFullLogString(value, budget);
  if (budget.remaining <= jsonByteLength(FULL_LOG_TRUNCATION_MARKER)) {
    budget.remaining = 0;
    return FULL_LOG_TRUNCATION_MARKER;
  }
  if (Array.isArray(value)) {
    const result: SafeLogValue[] = [];
    for (const item of value) {
      const candidate = [...result, item];
      if (jsonByteLength(candidate) <= budget.remaining) {
        result.push(item);
        continue;
      }
      const childBudget = { remaining: Math.max(0, budget.remaining - 2) };
      const fitted = fitFullLogValue(item, childBudget);
      const fittedCandidate = [...result, fitted];
      if (jsonByteLength(fittedCandidate) <= budget.remaining) result.push(fitted);
      break;
    }
    if (result.length < value.length && jsonByteLength([...result, FULL_LOG_TRUNCATION_MARKER]) <= budget.remaining) {
      result.push(FULL_LOG_TRUNCATION_MARKER);
    }
    budget.remaining = Math.max(0, budget.remaining - jsonByteLength(result));
    return result.length ? result : FULL_LOG_TRUNCATION_MARKER;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, SafeLogValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const candidate = { ...result, [key]: item };
      if (jsonByteLength(candidate) <= budget.remaining) {
        result[key] = item;
        continue;
      }
      const childBudget = { remaining: Math.max(0, budget.remaining - 2) };
      const fitted = fitFullLogValue(item, childBudget);
      const fittedCandidate = { ...result, [key]: fitted };
      if (jsonByteLength(fittedCandidate) <= budget.remaining) result[key] = fitted;
      break;
    }
    const hasMore = Object.keys(result).length < Object.keys(value).length;
    if (hasMore && jsonByteLength({ ...result, _truncated: true }) <= budget.remaining) result._truncated = true;
    budget.remaining = Math.max(0, budget.remaining - jsonByteLength(result));
    return Object.keys(result).length ? result : FULL_LOG_TRUNCATION_MARKER;
  }
  budget.remaining = 0;
  return FULL_LOG_TRUNCATION_MARKER;
}

export function redactServerLogText(value: unknown, maxLength = 500) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/data:[^;,\s]+(?:;[^,\s]+)*,\S{32,}/gi, 'data:[redacted]')
    .replace(/((?:token|signature|sig|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
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

export function serialiseLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  context: LogSerialiseContext = { fullLogBudget: { remaining: SERVER_LOG_MAX_BYTES } },
): SafeLogValue {
  if (isFullLogPayload(value)) {
    return fitFullLogValue(serialiseFullLogValue(value[FULL_LOG_PAYLOAD], depth, seen), context.fullLogBudget);
  }
  if (typeof value === 'string') return redactServerLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
  if (value instanceof Error) return serialiseLogError(value, depth, seen);
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => serialiseLogValue(item, depth + 1, seen, context));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const serialised: Record<string, SafeLogValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      serialised[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : serialiseLogValue(item, depth + 1, seen, context);
    }
    return serialised;
  }
  return redactServerLogText(value);
}

export function serialiseLogError(error: unknown, depth = 0, seen = new WeakSet<object>()): SafeLogValue {
  if (error instanceof Error) {
    const value = error as Error & { code?: unknown; status?: unknown; providerCode?: unknown; retryable?: unknown; cause?: unknown };
    return {
      name: value.name,
      message: redactServerLogText(value.message) || 'unknown error',
      ...(typeof value.code === 'string' || typeof value.code === 'number' ? { code: value.code } : {}),
      ...(typeof value.status === 'number' ? { status: value.status } : {}),
      ...(typeof value.providerCode === 'string' || typeof value.providerCode === 'number' ? { providerCode: value.providerCode } : {}),
      ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
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

let logPersistenceModule: Promise<typeof import('./server-log-persistence')> | null = null;

function queueServerLog(eventName: string, payload: Record<string, unknown>, level: ServerLogLevel) {
  // Middleware is bundled for the Edge runtime; the database writer is Node-only.
  // middleware 属于 Edge bundle，数据库写入器只允许在 Node runtime 动态加载。
  if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'edge') return;
  logPersistenceModule ||= import('./server-log-persistence');
  void logPersistenceModule
    .then((persistence) => persistence.queueServerLog(eventName, payload, level))
    .catch(() => { logPersistenceModule = null; });
}

export function logServerEvent(
  event: string,
  fields: ServerLogFields = {},
  level: ServerLogLevel = 'info',
) {
  try {
    const now = new Date();
    const value = {
      event,
      timestamp: formatServerLogTime(now),
      timestampUtc: now.toISOString(),
      ...fields,
    };
    let serialisedPayload = serialiseLogValue(
      value,
      0,
      new WeakSet<object>(),
      { fullLogBudget: { remaining: SERVER_LOG_MAX_BYTES } },
    );
    let line = JSON.stringify(serialisedPayload);
    if (utf8ByteLength(line) > SERVER_LOG_MAX_BYTES) {
      serialisedPayload = serialiseLogValue(
        { ...value, logPayloadTruncated: true },
        0,
        new WeakSet<object>(),
        { fullLogBudget: { remaining: 16 } },
      );
      line = JSON.stringify(serialisedPayload);
    }
    if (utf8ByteLength(line) > SERVER_LOG_MAX_BYTES) {
      serialisedPayload = {
        event,
        timestamp: value.timestamp,
        timestampUtc: value.timestampUtc,
        logPayloadTruncated: true,
      };
      line = JSON.stringify(serialisedPayload);
    }
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
    if (serialisedPayload && typeof serialisedPayload === 'object' && !Array.isArray(serialisedPayload)) {
      queueServerLog(event, serialisedPayload as Record<string, unknown>, level);
    }
  } catch {
    // Never let diagnostics break a generation or a chat response.
    try { console.error('{"event":"logging_failure","stage":"serialisation"}'); } catch { /* noop */ }
  }
}

export function logServerFailure(event: string, error: unknown, fields: ServerLogFields = {}) {
  logServerEvent(event, { ...fields, error: serialiseLogError(error) }, 'error');
}
