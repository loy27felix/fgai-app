import { Buffer } from 'node:buffer';
import dayjs from 'dayjs';
import { query as dbQuery } from '@/lib/local/db';

export const LOG_SOURCES = ['audit', 'frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data'] as const;
export type LogSource = typeof LOG_SOURCES[number];
export type LogSourceFilter = LogSource | 'all';

export const LOG_LEVELS = ['info', 'warning', 'error', 'critical'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export type LogLevelFilter = LogLevel | 'all';
export type LogKind = 'audit' | 'error' | 'service' | 'log';

const DEFAULT_RANGE_MS = 15 * 60 * 1_000;
const MAX_RANGE_MONTHS = 3;
const MAX_LOG_LIMIT = 200;
const MAX_LOG_OFFSET = 5_000;
const MAX_QUERY_LENGTH = 512;

export class LogQueryValidationError extends Error {}

export type LogQueryInput = {
  from?: Date | string;
  to?: Date | string;
  query?: string;
  source?: string;
  level?: string;
  offset?: number | string;
  limit?: number | string;
  cursor?: string | null;
};

export type NormalizedLogQuery = {
  from: Date;
  to: Date;
  query: string;
  source: LogSourceFilter;
  level: LogLevelFilter;
  offset: number;
  limit: number;
  cursor: LogCursor | null;
};

export type LogRecord = {
  id: string;
  eventId: string | null;
  kind: LogKind;
  occurredAt: string;
  source: string;
  service: string;
  event: string;
  level: LogLevel;
  outcome: string;
  message: string;
  traceId: string | null;
  requestId: string | null;
  taskId: string | null;
  userId: string | null;
  actorEmail: string | null;
  route: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  details: Record<string, unknown>;
};

export type LogTimelineBucket = {
  bucket: string;
  total: number;
  info: number;
  warning: number;
  error: number;
  critical: number;
};

export type LogExplorerResult = {
  from: string;
  to: string;
  query: string;
  source: LogSourceFilter;
  level: LogLevelFilter;
  bucketSeconds: number;
  rows: LogRecord[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  nextCursor: string | null;
  summary: {
    total: number;
    info: number;
    warning: number;
    error: number;
    critical: number;
    sourceCount: number;
    serviceCount: number;
  };
  timeline: LogTimelineBucket[];
};

type LogRow = {
  id: string;
  event_id: string | null;
  kind: LogKind;
  occurred_at: Date | string;
  source: string;
  service: string;
  event_name: string;
  level: LogLevel;
  outcome: string;
  message: string;
  trace_id: string | null;
  request_id: string | null;
  task_id: string | null;
  user_id: string | null;
  actor_email: string | null;
  route: string | null;
  http_status: number | string | null;
  duration_ms: number | string | null;
  details: unknown;
  sequence_id: number | string;
};

type SummaryRow = {
  total: number | string;
  info: number | string;
  warning: number | string;
  error: number | string;
  critical: number | string;
  source_count: number | string;
  service_count: number | string;
};

type TimelineRow = {
  bucket: Date | string;
  total: number | string;
  info: number | string;
  warning: number | string;
  error: number | string;
  critical: number | string;
};

type LogCursor = {
  occurredAt: string;
  sequenceId: string;
  id: string;
};

// Keep all durable event streams in one SQL shape for consistent filtering.
// 将所有持久化观测流统一成同一 SQL 结构，确保筛选、统计和详情展示使用同一口径。
const LOG_CTE = `with logs as (
  select
    'audit:' || audit_events.id::text as id,
    event_id::text as event_id,
    'audit'::text as kind,
    occurred_at,
    'audit'::text as source,
    feature as service,
    coalesce(nullif(concat_ws('.', feature, action, stage), ''), 'audit') as event_name,
    case
      when outcome = 'failed' then 'error'
      when outcome in ('rejected', 'unknown') then 'warning'
      else 'info'
    end as level,
    outcome,
    coalesce(nullif(error->>'message', ''), concat_ws(' · ', concat_ws('.', feature, action), stage, outcome)) as message,
    trace_id,
    coalesce(data->>'requestId', metadata->>'requestId') as request_id,
    coalesce(data->>'taskId', resource_id) as task_id,
    actor_id::text as user_id,
    actor_profile.email as actor_email,
    coalesce(data->>'route', metadata->>'route') as route,
    null::integer as http_status,
    duration_ms,
    jsonb_build_object(
      'eventId', event_id,
      'actorId', actor_id,
      'workspaceId', workspace_id,
      'feature', feature,
      'action', action,
      'resourceType', resource_type,
      'resourceId', resource_id,
      'stage', stage,
      'outcome', outcome,
      'statusBefore', status_before,
      'statusAfter', status_after,
      'parameters', parameters,
      'data', data,
      'error', error,
      'metadata', metadata
    ) as details,
    concat_ws(' ', event_id::text, feature, action, stage, outcome, resource_type, resource_id,
      trace_id, actor_id::text, actor_profile.email, workspace_id::text, parameters::text, data::text,
      error::text, metadata::text) as search_text,
    audit_events.id as sequence_id
  from audit_events
  left join profiles actor_profile on actor_profile.id = audit_events.actor_id

  union all

  select
    'log:' || log.id::text as id,
    log.event_id,
    'log'::text as kind,
    log.occurred_at,
    log.source,
    log.service,
    log.event_name,
    log.level,
    log.outcome,
    coalesce(nullif(log.message, ''), nullif(log.outcome, ''), log.event_name) as message,
    log.trace_id,
    log.request_id,
    log.task_id,
    log.user_id,
    log_actor.email as actor_email,
    log.route,
    log.http_status,
    log.duration_ms,
    log.payload as details,
    concat_ws(' ', log.search_text, log_actor.email) as search_text,
    log.id as sequence_id
  from observability_log_events log
  left join profiles log_actor on log_actor.id::text = log.user_id
  where not exists (
    select 1
      from audit_events audit
     where log.event_id is not null
       and audit.event_id::text = log.event_id
  )

  union all

  select
    'error:' || observability_error_events.id::text as id,
    event_key::text as event_id,
    'error'::text as kind,
    occurred_at,
    source,
    service,
    coalesce(nullif(concat_ws('.', feature, action, code), ''), nullif(service, ''), 'error') as event_name,
    severity as level,
    severity as outcome,
    coalesce(nullif(message, ''), nullif(code, ''), 'error') as message,
    trace_id,
    request_id,
    task_id,
    user_id::text,
    error_actor.email as actor_email,
    route,
    http_status,
    null::integer as duration_ms,
    jsonb_build_object(
      'fingerprint', fingerprint,
      'eventKey', event_key,
      'feature', feature,
      'action', action,
      'code', code,
      'stack', stack,
      'deploymentVersion', deployment_version,
      'metadata', metadata
    ) as details,
    concat_ws(' ', event_key, source, service, feature, action, severity, impact, fingerprint,
      code, message, stack, trace_id, request_id, task_id, user_id::text, route,
      http_status::text, deployment_version, error_actor.email, metadata::text) as search_text,
    observability_error_events.id as sequence_id
  from observability_error_events
  left join profiles error_actor on error_actor.id = observability_error_events.user_id

  union all

  select
    'service:' || id::text as id,
    event_key::text as event_id,
    'service'::text as kind,
    observed_at as occurred_at,
    'infra'::text as source,
    service,
    coalesce(nullif(concat_ws('.', service, check_name), ''), 'service.health') as event_name,
    case when state = 'unhealthy' then 'error' when state = 'unknown' then 'warning' else 'info' end as level,
    state as outcome,
    coalesce(nullif(message, ''), concat_ws(' · ', service, check_name, state)) as message,
    null::text as trace_id,
    null::text as request_id,
    null::text as task_id,
    null::text as user_id,
    null::text as actor_email,
    null::text as route,
    null::integer as http_status,
    duration_ms,
    jsonb_build_object(
      'host', host,
      'eventKey', event_key,
      'checkName', check_name,
      'state', state,
      'previousState', previous_state,
      'containerId', container_id,
      'deploymentVersion', deployment_version,
      'metadata', metadata
    ) as details,
    concat_ws(' ', event_key, host, service, check_name, state, previous_state, message,
      deployment_version, container_id, metadata::text) as search_text,
    id as sequence_id
  from observability_service_events
)`;

function numberValue(value: number | string | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateValue(value: Date | string | undefined) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function enumFilter<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, label: string) {
  if (!value) return fallback;
  if (!allowed.includes(value as T)) throw new LogQueryValidationError(`${label}无效`);
  return value as T;
}

function decodeCursor(value: string | null | undefined): LogCursor | null {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error('cursor too long');
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<LogCursor>;
    const occurredAt = dateValue(typeof parsed.occurredAt === 'string' ? parsed.occurredAt : undefined);
    const sequenceId = String(parsed.sequenceId ?? '');
    if (!occurredAt || !/^\d+$/.test(sequenceId) || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('invalid cursor');
    }
    return { occurredAt: occurredAt.toISOString(), sequenceId, id: parsed.id.slice(0, 240) };
  } catch {
    throw new LogQueryValidationError('日志游标无效');
  }
}

function encodeCursor(row: LogRow): string {
  const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString();
  const cursor: LogCursor = { occurredAt, sequenceId: String(row.sequence_id), id: row.id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function normalizeLogQuery(input: LogQueryInput = {}): NormalizedLogQuery {
  const to = input.to === undefined ? new Date() : dateValue(input.to);
  const from = input.from === undefined
    ? new Date((to || new Date()).getTime() - DEFAULT_RANGE_MS)
    : dateValue(input.from);
  if (!from || !to) throw new LogQueryValidationError('时间格式无效');
  if (from >= to) throw new LogQueryValidationError('开始时间必须早于结束时间');
  if (to.getTime() > dayjs(from).add(MAX_RANGE_MONTHS, 'month').valueOf()) throw new LogQueryValidationError('时间范围不能超过 3 个月');

  const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';
  if (rawQuery.length > MAX_QUERY_LENGTH) throw new LogQueryValidationError(`搜索词不能超过 ${MAX_QUERY_LENGTH} 个字符`);
  const queryText = rawQuery;
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  const limit = input.limit === undefined ? MAX_LOG_LIMIT : Number(input.limit);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LOG_OFFSET) throw new LogQueryValidationError('日志分页位置无效');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) throw new LogQueryValidationError('日志条数无效');

  return {
    from,
    to,
    query: queryText,
    source: enumFilter(input.source, ['all', ...LOG_SOURCES] as const, 'all', '日志来源'),
    level: enumFilter(input.level, ['all', ...LOG_LEVELS] as const, 'all', '日志级别'),
    offset,
    limit,
    cursor: decodeCursor(input.cursor),
  };
}

function appendDimensionFilters(filters: NormalizedLogQuery, clauses: string[], values: unknown[], startIndex: number) {
  let index = startIndex;
  if (filters.source !== 'all') {
    clauses.push(`source = $${index}`);
    values.push(filters.source);
    index += 1;
  }
  if (filters.level !== 'all') {
    clauses.push(`level = $${index}`);
    values.push(filters.level);
    index += 1;
  }
  if (filters.query) {
    // Escape LIKE metacharacters so identifiers such as `trace_id` remain literal search terms.
    // 转义 LIKE 通配符，保证 `trace_id` 这类字段名按原文检索而不是被改写。
    clauses.push(`search_text ILIKE $${index} ESCAPE E'\\\\'`);
    values.push(`%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  }
}

function listScope(filters: NormalizedLogQuery, cursor: LogCursor | null = null) {
  const clauses = ['occurred_at >= $1', 'occurred_at < $2'];
  const values: unknown[] = [filters.from.toISOString(), filters.to.toISOString()];
  appendDimensionFilters(filters, clauses, values, 3);
  if (cursor) {
    const cursorIndex = values.length + 1;
    clauses.push(`(occurred_at, sequence_id, id) < ($${cursorIndex}::timestamptz, $${cursorIndex + 1}::bigint, $${cursorIndex + 2})`);
    values.push(cursor.occurredAt, cursor.sequenceId, cursor.id);
  }
  return { where: `where ${clauses.join(' and ')}`, values };
}

function timelineScope(filters: NormalizedLogQuery, interval: string) {
  const clauses = ['occurred_at >= $1', 'occurred_at < $2'];
  const values: unknown[] = [filters.from.toISOString(), filters.to.toISOString(), interval];
  appendDimensionFilters(filters, clauses, values, 4);
  return { where: `where ${clauses.join(' and ')}`, values };
}

function bucketForRange(filters: NormalizedLogQuery) {
  const rangeMs = filters.to.getTime() - filters.from.getTime();
  if (rangeMs <= 30 * 60 * 1_000) return { interval: '1 minute', seconds: 60 };
  if (rangeMs <= 3 * 60 * 60 * 1_000) return { interval: '5 minutes', seconds: 300 };
  if (rangeMs <= 12 * 60 * 60 * 1_000) return { interval: '15 minutes', seconds: 900 };
  if (rangeMs <= 2 * 24 * 60 * 60 * 1_000) return { interval: '1 hour', seconds: 3_600 };
  if (rangeMs <= 14 * 24 * 60 * 60 * 1_000) return { interval: '6 hours', seconds: 21_600 };
  return { interval: '1 day', seconds: 86_400 };
}

function normalizeRecord(row: LogRow): LogRecord {
  const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
    ? row.details as Record<string, unknown>
    : {};
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    source: row.source,
    service: row.service,
    event: row.event_name,
    level: row.level,
    outcome: row.outcome,
    message: row.message,
    traceId: row.trace_id,
    requestId: row.request_id,
    taskId: row.task_id,
    userId: row.user_id,
    actorEmail: row.actor_email,
    route: row.route,
    httpStatus: nullableNumber(row.http_status),
    durationMs: nullableNumber(row.duration_ms),
    details,
  };
}

function normalizeTimeline(row: TimelineRow): LogTimelineBucket {
  return {
    bucket: row.bucket instanceof Date ? row.bucket.toISOString() : new Date(row.bucket).toISOString(),
    total: numberValue(row.total),
    info: numberValue(row.info),
    warning: numberValue(row.warning),
    error: numberValue(row.error),
    critical: numberValue(row.critical),
  };
}

export async function queryLogExplorer(input: LogQueryInput = {}): Promise<LogExplorerResult> {
  const filters = normalizeLogQuery(input);
  const scope = listScope(filters, filters.cursor);
  const limitIndex = scope.values.length + 1;
  const offsetIndex = scope.values.length + 2;
  const listResult = dbQuery<LogRow>(
    `${LOG_CTE}
     select id, event_id, kind, occurred_at, source, service, event_name, level, outcome,
            message, trace_id, request_id, task_id, user_id, actor_email, route, http_status,
            duration_ms, details, sequence_id
       from logs
      ${scope.where}
      order by occurred_at desc, sequence_id desc, id desc
      limit $${limitIndex} offset $${offsetIndex}`,
    [...scope.values, filters.limit + 1, filters.cursor ? 0 : filters.offset],
  );

  const summaryScope = listScope(filters);
  const summaryResult = dbQuery<SummaryRow>(
    `${LOG_CTE}
     select count(*)::int as total,
            count(*) filter (where level = 'info')::int as info,
            count(*) filter (where level = 'warning')::int as warning,
            count(*) filter (where level = 'error')::int as error,
            count(*) filter (where level = 'critical')::int as critical,
            count(distinct source)::int as source_count,
            count(distinct service)::int as service_count
       from logs
      ${summaryScope.where}`,
    summaryScope.values,
  );

  const bucket = bucketForRange(filters);
  const timelineScopeValue = timelineScope(filters, bucket.interval);
  const timelineResult = dbQuery<TimelineRow>(
    `${LOG_CTE}
     select date_bin($3::interval, occurred_at, $1::timestamptz) as bucket,
            count(*)::int as total,
            count(*) filter (where level = 'info')::int as info,
            count(*) filter (where level = 'warning')::int as warning,
            count(*) filter (where level = 'error')::int as error,
            count(*) filter (where level = 'critical')::int as critical
       from logs
      ${timelineScopeValue.where}
      group by 1
      order by 1 asc`,
    timelineScopeValue.values,
  );

  const [list, summary, timeline] = await Promise.all([listResult, summaryResult, timelineResult]);
  const summaryRow = summary.rows[0] || { total: 0, info: 0, warning: 0, error: 0, critical: 0, source_count: 0, service_count: 0 };
  const total = numberValue(summaryRow.total);
  const hasMore = list.rows.length > filters.limit;
  const visibleRows = list.rows.slice(0, filters.limit);
  const rows = visibleRows.map(normalizeRecord);
  return {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    query: filters.query,
    source: filters.source,
    level: filters.level,
    bucketSeconds: bucket.seconds,
    rows,
    total,
    hasMore,
    nextOffset: filters.offset + rows.length,
    nextCursor: hasMore && visibleRows.length ? encodeCursor(visibleRows[visibleRows.length - 1]) : null,
    summary: {
      total,
      info: numberValue(summaryRow.info),
      warning: numberValue(summaryRow.warning),
      error: numberValue(summaryRow.error),
      critical: numberValue(summaryRow.critical),
      sourceCount: numberValue(summaryRow.source_count),
      serviceCount: numberValue(summaryRow.service_count),
    },
    timeline: timeline.rows.map(normalizeTimeline),
  };
}
