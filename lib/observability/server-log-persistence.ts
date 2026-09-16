import { Pool } from 'pg';

type ServerLogLevel = 'info' | 'warn' | 'error';
type LogSource = 'audit' | 'frontend' | 'app' | 'provider' | 'infra' | 'deploy' | 'billing' | 'data';
type PersistedServerLog = {
  occurredAt: string;
  eventId: string | null;
  source: LogSource;
  service: string;
  eventName: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  outcome: string;
  message: string;
  traceId: string | null;
  requestId: string | null;
  taskId: string | null;
  userId: string | null;
  route: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  payload: Record<string, unknown>;
  searchText: string;
};

const logPersistencePool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://fg_studio:fg_studio@postgres:5432/fg_studio',
  max: 1,
  connectionTimeoutMillis: 1_000,
  idleTimeoutMillis: 10_000,
  statement_timeout: 2_000,
});
const LOG_PERSISTENCE_QUEUE_LIMIT = 2_000;
const LOG_PERSISTENCE_BATCH_SIZE = 40;
const LOG_PERSISTENCE_COOLDOWN_MS = 10_000;
const LOG_SOURCES: readonly LogSource[] = ['audit', 'frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data'];
const pendingServerLogs: PersistedServerLog[] = [];
let logFlushScheduled = false;
let logFlushRunning = false;
let droppedServerLogs = 0;
let logPersistenceDisabledUntil = 0;

logPersistencePool.on('error', () => undefined);

function redact(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/((?:token|signature|sig|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function logField(payload: Record<string, unknown>, path: string[]) {
  let value: unknown = payload;
  for (const key of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function logFieldText(payload: Record<string, unknown>, paths: string[][], maxLength: number) {
  for (const path of paths) {
    const value = logField(payload, path);
    if (typeof value === 'string' && value.trim()) return redact(value, maxLength);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, maxLength);
  }
  return null;
}

function logFieldNumber(payload: Record<string, unknown>, paths: string[]) {
  const value = logField(payload, paths);
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}

function persistedLogLevel(level: ServerLogLevel): PersistedServerLog['level'] {
  return level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info';
}

function persistedLogSource(eventName: string, payload: Record<string, unknown>): LogSource {
  const explicit = logFieldText(payload, [['source']], 40);
  if (explicit && LOG_SOURCES.includes(explicit as LogSource)) return explicit as LogSource;
  const provider = logFieldText(payload, [['provider']], 80);
  if (provider || /provider|wetoken/i.test(eventName)) return 'provider';
  return 'app';
}

function buildPersistedServerLog(eventName: string, payload: Record<string, unknown>, level: ServerLogLevel): PersistedServerLog {
  const message = logFieldText(payload, [['message'], ['error', 'message'], ['reason'], ['stage'], ['outcome']], 1_000) || eventName;
  const service = logFieldText(payload, [['service'], ['feature'], ['provider']], 120) || eventName;
  const occurredAtValue = logFieldText(payload, [['timestampUtc']], 80);
  const occurredAtDate = occurredAtValue ? new Date(occurredAtValue) : new Date();
  const occurredAt = Number.isNaN(occurredAtDate.getTime()) ? new Date().toISOString() : occurredAtDate.toISOString();

  return {
    occurredAt,
    eventId: logFieldText(payload, [['eventId'], ['event_id']], 160),
    source: persistedLogSource(eventName, payload),
    service,
    eventName: redact(eventName, 240) || 'server.log',
    level: persistedLogLevel(level),
    outcome: logFieldText(payload, [['outcome'], ['stage'], ['status'], ['reason']], 160) || '',
    message,
    traceId: logFieldText(payload, [['traceId'], ['trace_id']], 160),
    requestId: logFieldText(payload, [['requestId'], ['request_id']], 160),
    taskId: logFieldText(payload, [['taskId'], ['task_id']], 160),
    userId: logFieldText(payload, [['userId'], ['user_id'], ['actorId'], ['actor_id']], 160),
    route: logFieldText(payload, [['route'], ['path']], 240),
    httpStatus: logFieldNumber(payload, ['httpStatus']) ?? logFieldNumber(payload, ['http_status']),
    durationMs: logFieldNumber(payload, ['durationMs']) ?? logFieldNumber(payload, ['duration_ms']),
    payload,
    searchText: [eventName, service, message, JSON.stringify(payload)].join(' '),
  };
}

function reportLogPersistenceFailure(error: unknown, batchSize: number) {
  try {
    const message = error instanceof Error ? redact(error.message, 500) : redact(error, 500);
    console.error(JSON.stringify({ event: 'observability_log_persistence_failed', batchSize, message }));
  } catch {
    // Keep the stdout fallback best-effort and non-blocking.
    // stdout 旁路同样只做尽力记录，不能反向阻断业务请求。
  }
}

async function flushServerLogQueue() {
  if (logFlushRunning || !pendingServerLogs.length) return;
  logFlushRunning = true;
  const batch = pendingServerLogs.splice(0, LOG_PERSISTENCE_BATCH_SIZE);
  try {
    const columns = [
      'occurred_at', 'event_id', 'source', 'service', 'event_name', 'level', 'outcome',
      'message', 'trace_id', 'request_id', 'task_id', 'user_id', 'route', 'http_status',
      'duration_ms', 'payload', 'search_text',
    ];
    const values = batch.flatMap((item) => [
      item.occurredAt,
      item.eventId,
      item.source,
      item.service,
      item.eventName,
      item.level,
      item.outcome,
      item.message,
      item.traceId,
      item.requestId,
      item.taskId,
      item.userId,
      item.route,
      item.httpStatus,
      item.durationMs,
      JSON.stringify(item.payload),
      item.searchText,
    ]);
    const tuples = batch.map((_, rowIndex) => `(${columns.map((_, columnIndex) => {
      const parameter = rowIndex * columns.length + columnIndex + 1;
      return columnIndex === 15 ? `$${parameter}::jsonb` : `$${parameter}`;
    }).join(', ')})`).join(', ');
    await logPersistencePool.query(
      `insert into observability_log_events (${columns.join(', ')}) values ${tuples}`,
      values,
    );
  } catch (error) {
    // Requeue the failed atomic batch so a transient database outage does not erase it.
    // 失败批次重新排队，避免数据库短暂故障直接抹掉本批日志；请求仍不等待重试。
    reportLogPersistenceFailure(error, batch.length);
    const available = Math.max(0, LOG_PERSISTENCE_QUEUE_LIMIT - pendingServerLogs.length);
    if (available > 0) pendingServerLogs.unshift(...batch.slice(0, available));
    if (available < batch.length) droppedServerLogs += batch.length - available;
    logPersistenceDisabledUntil = Date.now() + LOG_PERSISTENCE_COOLDOWN_MS;
    const retryTimer = setTimeout(() => {
      if (pendingServerLogs.length && Date.now() >= logPersistenceDisabledUntil) void flushServerLogQueue();
    }, LOG_PERSISTENCE_COOLDOWN_MS + 10);
    retryTimer.unref();
  } finally {
    logFlushRunning = false;
    if (pendingServerLogs.length && Date.now() >= logPersistenceDisabledUntil) {
      setImmediate(() => { void flushServerLogQueue(); });
    }
  }
}

export function queueServerLog(eventName: string, payload: Record<string, unknown>, level: ServerLogLevel) {
  if (pendingServerLogs.length >= LOG_PERSISTENCE_QUEUE_LIMIT) {
    droppedServerLogs += 1;
    if (droppedServerLogs === 1 || droppedServerLogs % 100 === 0) {
      try {
        console.error(JSON.stringify({
          event: 'observability_log_persistence_backpressure',
          droppedCount: droppedServerLogs,
          queueLimit: LOG_PERSISTENCE_QUEUE_LIMIT,
        }));
      } catch {
        // Logging must not affect the business path.
        // 日志告警本身也不能影响业务路径。
      }
    }
    return;
  }
  pendingServerLogs.push(buildPersistedServerLog(eventName, payload, level));
  if (Date.now() < logPersistenceDisabledUntil) return;
  if (logFlushScheduled) return;
  logFlushScheduled = true;
  setImmediate(() => {
    logFlushScheduled = false;
    void flushServerLogQueue();
  });
}
