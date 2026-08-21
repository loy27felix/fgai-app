type ImageLogLevel = 'info' | 'warn' | 'error';

export type CreatorImageLogFields = Record<string, unknown>;

export function redactCreatorImageLogText(value: unknown) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[已隐藏]')
    .replace(/((?:token|signature|sig|key|secret|password)=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function safeError(error: unknown, depth = 0): Record<string, unknown> {
  if (error instanceof Error) {
    const value = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
    return {
      name: value.name,
      message: redactCreatorImageLogText(value.message),
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(typeof value.status === 'number' ? { status: value.status } : {}),
      ...(depth === 0 && value.cause !== undefined ? { cause: safeError(value.cause, depth + 1) } : {}),
    };
  }
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const value = error as Record<string, unknown>;
    return {
      ...(typeof value.name === 'string' ? { name: redactCreatorImageLogText(value.name) } : {}),
      message: redactCreatorImageLogText(value.message || value.error) || 'unknown error',
      ...(typeof value.code === 'string' ? { code: redactCreatorImageLogText(value.code) } : {}),
      ...(typeof value.status === 'number' ? { status: value.status } : {}),
    };
  }
  return { message: redactCreatorImageLogText(error) || 'unknown error' };
}

function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactCreatorImageLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
  if (value instanceof Error) return safeValue(safeError(value), depth, seen);
  if (depth >= 6) return '[已截断]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, safeValue(item, depth + 1, seen)]),
    );
  }
  return redactCreatorImageLogText(value);
}

function write(level: ImageLogLevel, payload: CreatorImageLogFields) {
  try {
    const line = JSON.stringify(safeValue({
      event: 'creator_image',
      timestamp: new Date().toISOString(),
      ...payload,
    }));
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  } catch {
    try { console.error('{"event":"creator_image","stage":"logging_failed"}'); } catch { /* logging must not break generation / 日志失败不能影响生成 */ }
  }
}

export function logCreatorImageEvent(
  stage: string,
  fields: CreatorImageLogFields = {},
  level: ImageLogLevel = 'info',
) {
  try { write(level, { stage, ...fields }); } catch { /* logging must not break generation / 日志失败不能影响生成 */ }
}

export function logCreatorImageFailure(
  stage: string,
  error: unknown,
  fields: CreatorImageLogFields = {},
) {
  try {
    write('error', { stage, ...fields, error: safeError(error) });
  } catch {
    try { write('error', { stage, error: { message: 'error serialization failed' } }); } catch { /* logging must not break generation / 日志失败不能影响生成 */ }
  }
}
