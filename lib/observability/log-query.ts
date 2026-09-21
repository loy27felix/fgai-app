import { Buffer } from 'node:buffer';
import dayjs from 'dayjs';
import { query as dbQuery } from '@/lib/local/db';
import {
  LOG_LEVELS,
  LOG_SOURCES,
  type LogCategory,
  type LogDetail,
  type LogExplorerSnapshot,
  type LogLevel,
  type LogLevelFilter,
  type LogRecord,
  type LogSearch,
  type LogSourceFilter,
  type LogTimelineBucket,
  type StructuredFilters,
} from './log-search-contract';
import { serialiseLogValue } from './server-log';

export { LOG_LEVELS, LOG_SOURCES } from './log-search-contract';
export type {
  LogCategory,
  LogDetail,
  LogExplorerSnapshot,
  LogLevel,
  LogLevelFilter,
  LogRecord,
  LogSource,
  LogSourceFilter,
  LogTimelineBucket,
  StructuredFilters,
} from './log-search-contract';

export type LogKind = 'audit' | 'error' | 'service' | 'log';

const DEFAULT_RANGE_MS = 15 * 60 * 1_000;
const MAX_RANGE_MONTHS = 3;
const MAX_LOG_LIMIT = 200;
const MAX_LOG_OFFSET = 5_000;
const MAX_QUERY_LENGTH = 512;
const MAX_FILTER_VALUE_LENGTH = 256;

const TEXT_FILTER_FIELDS = ['service', 'event', 'route', 'outcome', 'traceId', 'requestId', 'taskId', 'userId', 'actorEmail'] as const;
type TextFilterField = typeof TEXT_FILTER_FIELDS[number];
type NumericFilterField = 'httpStatus' | 'durationMs';
type CategoryField = 'category';
type RangeFilter = { exact: number | null; min: number | null; max: number | null };

const SLS_FIELD_ALIASES: Record<string, TextFilterField | NumericFilterField | CategoryField> = {
  service: 'service',
  event: 'event',
  route: 'route',
  outcome: 'outcome',
  traceid: 'traceId',
  requestid: 'requestId',
  taskid: 'taskId',
  userid: 'userId',
  actoremail: 'actorEmail',
  status: 'httpStatus',
  httpstatus: 'httpStatus',
  duration: 'durationMs',
  durationms: 'durationMs',
  category: 'category',
};

export class LogQueryValidationError extends Error {}

export type LogQueryInput = {
  from?: Date | string;
  to?: Date | string;
  query?: string;
  source?: string;
  scope?: string;
  focus?: string;
  level?: string;
  offset?: number | string;
  limit?: number | string;
  cursor?: string | null;
  service?: string;
  event?: string;
  route?: string;
  outcome?: string;
  traceId?: string;
  requestId?: string;
  taskId?: string;
  userId?: string;
  actorEmail?: string;
  httpStatus?: number | string;
  httpStatusGte?: number | string;
  httpStatusLte?: number | string;
  durationMs?: number | string;
  durationMsGte?: number | string;
  durationMsLte?: number | string;
};

export type NormalizedLogQuery = {
  from: Date;
  to: Date;
  query: string;
  fullText: string;
  source: LogSourceFilter;
  scope: 'all' | LogCategory;
  focus: 'all' | 'app-first';
  level: LogLevelFilter;
  textFilters: Partial<Record<TextFilterField, string[]>>;
  httpStatus: RangeFilter;
  durationMs: RangeFilter;
  offset: number;
  limit: number;
  cursor: LogCursor | null;
};

type LogRow = {
  id: string;
  event_id: string | null;
  kind: LogKind;
  occurred_at: Date | string;
  source: string;
  category: LogCategory;
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
  category_browser: number | string;
  category_api: number | string;
  category_api_runtime: number | string;
  category_infrastructure: number | string;
  category_other: number | string;
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
const LOG_CTE = `with logs as materialized (
  select
    'audit:' || audit_events.id::text as id,
    event_id::text as event_id,
    'audit'::text as kind,
    occurred_at,
    'audit'::text as source,
    'other'::text as category,
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
    case
      when log.source = 'frontend' and log.route like '/api/%' then 'api'
      when log.source = 'frontend' then 'browser'
      when log.source in ('infra', 'deploy') then 'infrastructure'
      when lower(coalesce(log.service, '') || ' ' || coalesce(log.event_name, '')) ~ '(nas|tunnel|nginx)' then 'infrastructure'
      when log.source = 'app' and (log.event_name in ('http_request_received', 'http_exchange_completed') or log.service in ('http', 'browser-api')) then 'api'
      when log.source = 'app' then 'api_runtime'
      else 'other'
    end as category,
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
    and not (
      log.event_name = 'http_request_received'
      and log.trace_id is not null
      and exists (
        select 1
          from observability_log_events completed
         where completed.event_name = 'http_exchange_completed'
           and completed.trace_id = log.trace_id
      )
    )

  union all

  select
    'error:' || observability_error_events.id::text as id,
    event_key::text as event_id,
    'error'::text as kind,
    occurred_at,
    source,
    case
      when source = 'frontend' and route like '/api/%' then 'api'
      when source = 'frontend' then 'browser'
      when source in ('infra', 'deploy') then 'infrastructure'
      when lower(coalesce(service, '') || ' ' || coalesce(feature, '') || ' ' || coalesce(action, '') || ' ' || coalesce(code, '')) ~ '(nas|tunnel|nginx)' then 'infrastructure'
      when source = 'app' and (route is not null or http_status is not null) then 'api'
      when source = 'app' then 'api_runtime'
      else 'other'
    end as category,
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
    'infrastructure'::text as category,
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

function filterText(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new LogQueryValidationError(`${label}格式无效`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_FILTER_VALUE_LENGTH) throw new LogQueryValidationError(`${label}不能超过 ${MAX_FILTER_VALUE_LENGTH} 个字符`);
  return normalized;
}

function rangeValue(value: unknown, label: string, minimum: number, maximum: number) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) throw new LogQueryValidationError(`${label}必须是整数`);
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new LogQueryValidationError(`${label}超出允许范围`);
  }
  return normalized;
}

function emptyRange(): RangeFilter {
  return { exact: null, min: null, max: null };
}

function addTextFilter(filters: Partial<Record<TextFilterField, string[]>>, field: TextFilterField, value: string) {
  const values = filters[field] || [];
  if (!values.includes(value)) values.push(value);
  filters[field] = values;
}

function addRangeFilter(range: RangeFilter, operator: ':' | '=' | '>=' | '<=', value: number, label: string) {
  if (operator === ':' || operator === '=') {
    if (range.exact !== null && range.exact !== value) throw new LogQueryValidationError(`${label}条件冲突`);
    range.exact = value;
  } else if (operator === '>=') {
    range.min = range.min === null ? value : Math.max(range.min, value);
  } else {
    range.max = range.max === null ? value : Math.min(range.max, value);
  }
  if ((range.min !== null && range.max !== null && range.min > range.max)
    || (range.exact !== null && ((range.min !== null && range.exact < range.min) || (range.max !== null && range.exact > range.max)))) {
    throw new LogQueryValidationError(`${label}条件冲突`);
  }
}

function addInputRange(range: RangeFilter, exact: unknown, minimum: unknown, maximum: unknown, label: string, lowerBound: number, upperBound: number) {
  const exactValue = rangeValue(exact, label, lowerBound, upperBound);
  const minimumValue = rangeValue(minimum, label, lowerBound, upperBound);
  const maximumValue = rangeValue(maximum, label, lowerBound, upperBound);
  if (exactValue !== null) addRangeFilter(range, '=', exactValue, label);
  if (minimumValue !== null) addRangeFilter(range, '>=', minimumValue, label);
  if (maximumValue !== null) addRangeFilter(range, '<=', maximumValue, label);
}

function parseSlsQuery(query: string) {
  const textFilters: Partial<Record<TextFilterField, string[]>> = {};
  const httpStatus = emptyRange();
  const durationMs = emptyRange();
  const fullText: string[] = [];
  let category: LogCategory | null = null;
  let index = 0;

  while (index < query.length) {
    while (/\s/.test(query[index] || '')) index += 1;
    if (index >= query.length) break;
    const tokenStart = index;
    while (index < query.length && !/\s/.test(query[index])) index += 1;
    const head = query.slice(tokenStart, index);
    const match = /^([A-Za-z][A-Za-z0-9]*)(:|=|>=|<=)(.*)$/.exec(head);
    if (!match) {
      const malformedOperator = /^([A-Za-z][A-Za-z0-9]*)(?:>|<|!)/.exec(head);
      if (malformedOperator) {
        throw new LogQueryValidationError(`SLS 字段 ${malformedOperator[1]} 的比较符无效`);
      }
      if (head.includes('"')) throw new LogQueryValidationError('SLS 全文词不能包含未配对的引号');
      fullText.push(head);
      continue;
    }

    const [, rawField, operator, inlineValue] = match;
    const field = SLS_FIELD_ALIASES[rawField.toLowerCase()];
    // Keep legacy `q` searches such as `error:timeout` as one literal full-text term.
    // 保留旧版 q 中 `error:timeout` 这类包含冒号的全文词，避免升级后改变检索含义。
    if (!field) {
      if (operator === ':') {
        fullText.push(head);
        continue;
      }
      throw new LogQueryValidationError(`不支持的 SLS 字段或比较符：${rawField}${operator}`);
    }
    let rawValue = inlineValue;
    if (rawValue.startsWith('"')) {
      const inlineQuotedValue = rawValue.slice(1);
      const quotedSource = inlineQuotedValue + query.slice(index);
      let closed = false;
      rawValue = '';
      let quotedIndex = 0;
      while (quotedIndex < quotedSource.length) {
        const character = quotedSource[quotedIndex++];
        if (character === '\\') {
          const escaped = quotedSource[quotedIndex++];
          if (escaped !== '"' && escaped !== '\\') throw new LogQueryValidationError('SLS 引号仅支持 \\" 和 \\\\ 转义');
          rawValue += escaped;
        } else if (character === '"') {
          closed = true;
          break;
        } else {
          rawValue += character;
        }
      }
      if (!closed) throw new LogQueryValidationError('SLS 引号未闭合');
      if (quotedIndex < inlineQuotedValue.length) throw new LogQueryValidationError('SLS 引号值后必须以空格分隔');
      const consumedFromQuery = Math.max(0, quotedIndex - inlineQuotedValue.length);
      index += consumedFromQuery;
      if (index < query.length && !/\s/.test(query[index])) throw new LogQueryValidationError('SLS 引号值后必须以空格分隔');
    } else if (!rawValue || rawValue.includes('"')) {
      throw new LogQueryValidationError(`SLS 字段 ${rawField} 缺少有效值`);
    }

    if (field === 'category') {
      if (operator !== ':') throw new LogQueryValidationError(`SLS 字段 ${rawField} 只能使用 :`);
      const normalized = rawValue as LogCategory;
      if (!['browser', 'api', 'api_runtime', 'infrastructure', 'other'].includes(normalized)) {
        throw new LogQueryValidationError(`日志类别 ${rawValue} 无效`);
      }
      if (category && category !== normalized) throw new LogQueryValidationError('日志类别条件冲突');
      category = normalized;
    } else if (field === 'httpStatus' || field === 'durationMs') {
      if (operator !== ':' && operator !== '=' && operator !== '>=' && operator !== '<=') throw new LogQueryValidationError(`SLS 字段 ${rawField} 的比较符无效`);
      const label = field === 'httpStatus' ? 'HTTP 状态码' : '耗时';
      const value = rangeValue(rawValue, label, field === 'httpStatus' ? 100 : 0, field === 'httpStatus' ? 599 : 86_400_000);
      addRangeFilter(field === 'httpStatus' ? httpStatus : durationMs, operator as ':' | '=' | '>=' | '<=', value as number, label);
    } else {
      if (operator !== ':') throw new LogQueryValidationError(`SLS 字段 ${rawField} 只能使用 :`);
      const value = filterText(rawValue, rawField);
      if (!value) throw new LogQueryValidationError(`SLS 字段 ${rawField} 缺少有效值`);
      addTextFilter(textFilters, field, value);
    }
  }
  return { fullText: fullText.join(' '), textFilters, httpStatus, durationMs, category };
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
  const parsedQuery = parseSlsQuery(rawQuery);
  for (const field of TEXT_FILTER_FIELDS) {
    const value = filterText(input[field], field);
    if (value) addTextFilter(parsedQuery.textFilters, field, value);
  }
  addInputRange(parsedQuery.httpStatus, input.httpStatus, input.httpStatusGte, input.httpStatusLte, 'HTTP 状态码', 100, 599);
  addInputRange(parsedQuery.durationMs, input.durationMs, input.durationMsGte, input.durationMsLte, '耗时', 0, 86_400_000);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  const limit = input.limit === undefined ? MAX_LOG_LIMIT : Number(input.limit);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LOG_OFFSET) throw new LogQueryValidationError('日志分页位置无效');
  if (offset !== 0) throw new LogQueryValidationError('日志分页仅支持 cursor');
  if (!Number.isInteger(limit) || ![50, 100, 200].includes(limit)) throw new LogQueryValidationError('日志条数必须是 50、100 或 200');

  const requestedScope = enumFilter(input.scope, ['all', 'browser', 'api', 'api_runtime', 'infrastructure', 'other'] as const, 'all', '日志类别');
  const queryScope = parsedQuery.category || 'all';
  if (requestedScope !== 'all' && queryScope !== 'all' && requestedScope !== queryScope) {
    throw new LogQueryValidationError('日志类别条件冲突');
  }
  return {
    from,
    to,
    query: rawQuery,
    fullText: parsedQuery.fullText,
    source: enumFilter(input.source, ['all', ...LOG_SOURCES] as const, 'all', '日志来源'),
    scope: requestedScope === 'all' ? queryScope : requestedScope,
    focus: enumFilter(input.focus, ['all', 'app-first'] as const, 'all', '日志焦点'),
    level: enumFilter(input.level, ['all', ...LOG_LEVELS] as const, 'all', '日志级别'),
    textFilters: parsedQuery.textFilters,
    httpStatus: parsedQuery.httpStatus,
    durationMs: parsedQuery.durationMs,
    offset,
    limit,
    cursor: decodeCursor(input.cursor),
  };
}

type FilterDimension = 'category' | 'source' | 'level' | TextFilterField;

function appendDimensionFilters(filters: NormalizedLogQuery, clauses: string[], values: unknown[], startIndex: number, omit?: FilterDimension) {
  let index = startIndex;
  if (filters.scope !== 'all' && omit !== 'category') {
    clauses.push(`category = $${index}`);
    values.push(filters.scope);
    index += 1;
  }
  if (filters.source !== 'all' && omit !== 'source') {
    clauses.push(`source = $${index}`);
    values.push(filters.source);
    index += 1;
  }
  if (filters.level !== 'all' && omit !== 'level') {
    clauses.push(`level = $${index}`);
    values.push(filters.level);
    index += 1;
  }
  const columnByField: Record<TextFilterField, string> = {
    service: 'service',
    event: 'event_name',
    route: 'route',
    outcome: 'outcome',
    traceId: 'trace_id',
    requestId: 'request_id',
    taskId: 'task_id',
    userId: 'user_id',
    actorEmail: 'actor_email',
  };
  for (const field of TEXT_FILTER_FIELDS) {
    if (omit === field) continue;
    for (const value of filters.textFilters[field] || []) {
      clauses.push(`${columnByField[field]} = $${index}`);
      values.push(value);
      index += 1;
    }
  }
  for (const [column, operator, value] of [
    ['http_status', '=', filters.httpStatus.exact],
    ['http_status', '>=', filters.httpStatus.min],
    ['http_status', '<=', filters.httpStatus.max],
    ['duration_ms', '=', filters.durationMs.exact],
    ['duration_ms', '>=', filters.durationMs.min],
    ['duration_ms', '<=', filters.durationMs.max],
  ] as const) {
    if (value === null) continue;
    clauses.push(`${column} ${operator} $${index}`);
    values.push(value);
    index += 1;
  }
  if (filters.fullText) {
    // Escape LIKE metacharacters so identifiers such as `trace_id` remain literal search terms.
    // 转义 LIKE 通配符，保证 `trace_id` 这类字段名按原文检索而不是被改写。
    clauses.push(`search_text ILIKE $${index} ESCAPE E'\\\\'`);
    values.push(`%${filters.fullText.replace(/[\\%_]/g, '\\$&')}%`);
  }
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

function normalizeRecord(row: LogRow, includeDetails = false): LogRecord {
  const serialisedDetails = serialiseLogValue(row.details);
  const details = serialisedDetails && typeof serialisedDetails === 'object' && !Array.isArray(serialisedDetails)
    ? serialisedDetails as Record<string, unknown>
    : {};
  const record: LogRecord = {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    category: row.category,
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
  };
  if (includeDetails) record.details = details;
  return record;
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

function inputFilters(input: LogQueryInput): StructuredFilters {
  const filters: StructuredFilters = {};
  for (const key of TEXT_FILTER_FIELDS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) filters[key] = value.trim();
  }
  for (const key of ['httpStatus', 'httpStatusGte', 'httpStatusLte', 'durationMs', 'durationMsGte', 'durationMsLte'] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && String(value).trim()) filters[key] = String(value);
  }
  return filters;
}

function appliedSearch(filters: NormalizedLogQuery, input: LogQueryInput): LogSearch {
  return {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    q: filters.query,
    scope: filters.scope,
    level: filters.level,
    source: filters.source,
    filters: inputFilters(input),
    limit: filters.limit as 50 | 100 | 200,
    cursor: typeof input.cursor === 'string' ? input.cursor : null,
    focus: filters.focus,
  };
}

function orderClause() {
  return 'order by occurred_at desc, sequence_id desc, id desc';
}

export async function queryLogExplorer(input: LogQueryInput = {}): Promise<LogExplorerSnapshot> {
  const filters = normalizeLogQuery(input);
  const bucket = bucketForRange(filters);
  const values: unknown[] = [];
  const scopedWhere = (omit?: FilterDimension) => {
    const fromIndex = values.length + 1;
    const clauses = [`occurred_at >= $${fromIndex}`, `occurred_at < $${fromIndex + 1}`];
    values.push(filters.from.toISOString(), filters.to.toISOString());
    appendDimensionFilters(filters, clauses, values, values.length + 1, omit);
    return `where ${clauses.join(' and ')}`;
  };
  const baseWhere = scopedWhere();
  const pageClauses: string[] = [];
  const pageValues: unknown[] = [];
  if (filters.cursor) {
    const cursorIndex = 1;
    pageClauses.push(`(occurred_at, sequence_id, id) < ($${cursorIndex}::timestamptz, $${cursorIndex + 1}::bigint, $${cursorIndex + 2})`);
    pageValues.push(filters.cursor.occurredAt, filters.cursor.sequenceId, filters.cursor.id);
  }
  const pageWhere = pageClauses.length ? `where ${pageClauses.join(' and ')}` : '';
  pageValues.push(filters.limit + 1);
  const pageParamsOffset = values.length;
  const pageWhereSql = pageWhere.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) + pageParamsOffset}`);
  values.push(...pageValues);
  const pageLimitParam = `$${values.length}`;
  const scopeDefinitions = [
    ['category', 'category_scope', 'category_scope_json'],
    ['level', 'level_scope', 'level_scope_json'],
    ['source', 'source_scope', 'source_scope_json'],
    ['service', 'service_scope', 'service_scope_json'],
    ['event_name', 'event_scope', 'event_scope_json'],
  ] as const;
  const facetCtes = scopeDefinitions.map(([column, name, jsonName]) => `${name} as (
    select ${column}::text as value, count(*)::int as count
      from filtered
     group by ${column}
     order by count(*) desc, ${column} asc
     limit 12
  ), ${jsonName} as (
    select coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count)), '[]'::jsonb) as value
      from ${name}
  )`).join(',\n');
  const queryValues = values;
  const result = await dbQuery<{
    rows_json: unknown;
    summary_json: SummaryRow | string;
    timeline_json: TimelineRow[] | string;
    category_json: Array<{ value: string; count: number }> | string;
    level_json: Array<{ value: string; count: number }> | string;
    source_json: Array<{ value: string; count: number }> | string;
    service_json: Array<{ value: string; count: number }> | string;
    event_json: Array<{ value: string; count: number }> | string;
  }>(
    `${LOG_CTE},
    filtered as (
      select * from logs ${baseWhere}
    ),
    page as (
      select id, event_id, kind, occurred_at, source, category, service, event_name, level, outcome,
             message, trace_id, request_id, task_id, user_id, actor_email, route, http_status,
             duration_ms, details, sequence_id
        from filtered ${pageWhereSql}
       ${orderClause()}
       limit ${pageLimitParam}
    ),
    rows_json as (
      select coalesce(jsonb_agg(to_jsonb(page) order by occurred_at desc, sequence_id desc, id desc), '[]'::jsonb) as value
        from page
    ),
    summary_json as (
      select to_jsonb(summary) as value
        from (
          select count(*)::int as total,
                 count(*) filter (where level = 'info')::int as info,
                 count(*) filter (where level = 'warning')::int as warning,
                 count(*) filter (where level = 'error')::int as error,
                 count(*) filter (where level = 'critical')::int as critical,
                 count(distinct source)::int as source_count,
                 count(distinct service)::int as service_count,
                 count(*) filter (where category = 'browser')::int as category_browser,
                 count(*) filter (where category = 'api')::int as category_api,
                 count(*) filter (where category = 'api_runtime')::int as category_api_runtime,
                 count(*) filter (where category = 'infrastructure')::int as category_infrastructure,
                 count(*) filter (where category = 'other')::int as category_other
            from filtered
        ) summary
    ),
    timeline_json as (
      select coalesce(jsonb_agg(to_jsonb(timeline) order by bucket asc), '[]'::jsonb) as value
        from (
          select date_bin($${values.length + 1}::interval, occurred_at, $${values.length + 2}::timestamptz) as bucket,
                 count(*)::int as total,
                 count(*) filter (where level = 'info')::int as info,
                 count(*) filter (where level = 'warning')::int as warning,
                 count(*) filter (where level = 'error')::int as error,
                 count(*) filter (where level = 'critical')::int as critical
            from filtered
           group by 1
        ) timeline
    ),
    ${facetCtes}
    select (select value from rows_json) as rows_json,
           (select value from summary_json) as summary_json,
           (select value from timeline_json) as timeline_json,
           (select value from category_scope_json) as category_json,
           (select value from level_scope_json) as level_json,
           (select value from source_scope_json) as source_json,
           (select value from service_scope_json) as service_json,
           (select value from event_scope_json) as event_json`,
    [...queryValues, bucket.interval, filters.from.toISOString()],
  );
  const aggregate = result.rows[0];
  const jsonArray = <T,>(value: T[] | string | unknown): T[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  };
  const pageRows = jsonArray<LogRow>(aggregate?.rows_json);
  const summaryRow = (aggregate?.summary_json && typeof aggregate.summary_json === 'object'
    ? aggregate.summary_json
    : {}) as Partial<SummaryRow>;
  const timelineRows = jsonArray<TimelineRow>(aggregate?.timeline_json);
  const category = jsonArray<{ value: string; count: number }>(aggregate?.category_json)
    .map((row) => ({ value: row.value, label: row.value, count: numberValue(row.count) }));
  const level = jsonArray<{ value: string; count: number }>(aggregate?.level_json)
    .map((row) => ({ value: row.value, label: row.value, count: numberValue(row.count) }));
  const source = jsonArray<{ value: string; count: number }>(aggregate?.source_json)
    .map((row) => ({ value: row.value, label: row.value, count: numberValue(row.count) }));
  const service = jsonArray<{ value: string; count: number }>(aggregate?.service_json)
    .map((row) => ({ value: row.value, label: row.value, count: numberValue(row.count) }));
  const event = jsonArray<{ value: string; count: number }>(aggregate?.event_json)
    .map((row) => ({ value: row.value, label: row.value, count: numberValue(row.count) }));
  const summary = summaryRow || {
    total: 0, info: 0, warning: 0, error: 0, critical: 0, source_count: 0, service_count: 0,
    category_browser: 0, category_api: 0, category_api_runtime: 0, category_infrastructure: 0, category_other: 0,
  };
  const total = numberValue(summary.total);
  const hasMore = pageRows.length > filters.limit;
  const visibleRows = pageRows.slice(0, filters.limit);
  const rows = visibleRows.map((row) => normalizeRecord(row));
  const byLevel = { info: numberValue(summary.info), warning: numberValue(summary.warning), error: numberValue(summary.error), critical: numberValue(summary.critical) };
  const byCategory = {
    browser: numberValue(summary.category_browser),
    api: numberValue(summary.category_api),
    api_runtime: numberValue(summary.category_api_runtime),
    infrastructure: numberValue(summary.category_infrastructure),
    other: numberValue(summary.category_other),
  };
  return {
    applied: appliedSearch(filters, input),
    rows,
    page: {
      hasMore,
      nextCursor: hasMore && visibleRows.length ? encodeCursor(visibleRows[visibleRows.length - 1]) : null,
    },
    summary: {
      total,
      byCategory,
      byLevel,
      sourceCount: numberValue(summaryRow.source_count),
      serviceCount: numberValue(summaryRow.service_count),
    },
    facets: { category, level, source, service, event },
    bucketSeconds: bucket.seconds,
    timeline: timelineRows.map(normalizeTimeline),
  };
}

export async function getLogDetail(id: string): Promise<LogDetail | null> {
  if (!/^(audit|log|error|service):\d+$/.test(id)) return null;
  const result = await dbQuery<LogRow>(
    `${LOG_CTE}
     select id, event_id, kind, occurred_at, source, category, service, event_name, level, outcome,
            message, trace_id, request_id, task_id, user_id, actor_email, route, http_status,
            duration_ms, details, sequence_id
       from logs
      where id = $1
      limit 1`,
    [id],
  );
  return result.rows[0] ? normalizeRecord(result.rows[0], true) as LogDetail : null;
}
