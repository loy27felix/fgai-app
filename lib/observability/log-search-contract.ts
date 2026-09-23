export const LOG_SOURCES = ['audit', 'frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data'] as const;
export type LogSource = typeof LOG_SOURCES[number];
export type LogSourceFilter = LogSource | 'all';
export const LOG_LEVELS = ['info', 'warning', 'error', 'critical'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export type LogLevelFilter = LogLevel | 'all';

export const LOG_SEARCH_FILTER_KEYS = [
  'service', 'event', 'route', 'outcome', 'traceId', 'requestId', 'taskId', 'userId', 'actorEmail',
  'httpStatus', 'httpStatusGte', 'httpStatusLte', 'durationMs', 'durationMsGte', 'durationMsLte',
] as const;

export type StructuredFilterKey = typeof LOG_SEARCH_FILTER_KEYS[number];
export type StructuredFilters = Partial<Record<StructuredFilterKey, string>>;
export type LogCategory = 'browser' | 'api' | 'api_runtime' | 'infrastructure' | 'other';
export type LogScope = 'all' | LogCategory;
export type LogFocus = 'all' | 'app-first';
export type LogLimit = 50 | 100 | 200;

export type LogSearch = {
  from: string;
  to: string;
  q: string;
  scope: LogScope;
  level: LogLevelFilter;
  source: LogSourceFilter;
  filters: StructuredFilters;
  limit: LogLimit;
  cursor: string | null;
  focus: LogFocus;
};

export type LogSearchDraft = Omit<LogSearch, 'cursor'> & { cursor: null };

export type LogRecord = {
  id: string;
  eventId: string | null;
  kind: 'audit' | 'error' | 'service' | 'log';
  category: LogCategory;
  occurredAt: string;
  ingestedAt?: string | null;
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
  contextPreview: Array<{ key: string; value: string }>;
  details?: Record<string, unknown>;
};

export type LogDetail = LogRecord & { details: Record<string, unknown> };

export type LogTimelineBucket = {
  bucket: string;
  total: number;
  info: number;
  warning: number;
  error: number;
  critical: number;
};

export type LogFacet = { value: string; label: string; count: number };

export type LogExplorerSnapshot = {
  applied: LogSearch;
  rows: LogRecord[];
  page: { hasMore: boolean; nextCursor: string | null };
  summary: {
    total: number;
    byCategory: Record<string, number>;
    byLevel: Record<string, number>;
    sourceCount: number;
    serviceCount: number;
  };
  facets: {
    category: LogFacet[];
    level: LogFacet[];
    source: LogFacet[];
    service: LogFacet[];
    event: LogFacet[];
  };
  bucketSeconds: number;
  timeline: LogTimelineBucket[];
};

const DEFAULT_RANGE_MS = 15 * 60 * 1_000;
const DEFAULT_LIMIT: LogLimit = 50;
const LEGACY_FILTER_KEYS = LOG_SEARCH_FILTER_KEYS;

function iso(value: string | Date | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function defaultRange() {
  const to = new Date();
  return { from: new Date(to.getTime() - DEFAULT_RANGE_MS).toISOString(), to: to.toISOString() };
}

function validLimit(value: string | null): LogLimit {
  if (value === '100') return 100;
  if (value === '200') return 200;
  return DEFAULT_LIMIT;
}

function validScope(value: string | null): LogScope {
  const allowed: LogScope[] = ['all', 'browser', 'api', 'api_runtime', 'infrastructure', 'other'];
  return value && allowed.includes(value as LogScope) ? value as LogScope : 'all';
}

function validFocus(value: string | null): LogFocus {
  return value === 'app-first' ? 'app-first' : 'all';
}

function validLevel(value: string | null, fallback: LogLevelFilter): LogLevelFilter {
  if (!value || value === 'all') return fallback;
  return LOG_LEVELS.includes(value as LogLevel) ? value as LogLevel : fallback;
}

function validSource(value: string | null, fallback: LogSourceFilter): LogSourceFilter {
  if (!value || value === 'all') return fallback;
  return LOG_SOURCES.includes(value as LogSource) ? value as LogSource : fallback;
}

export function defaultLogSearch(now = new Date()): LogSearch {
  const to = now.toISOString();
  return {
    from: new Date(now.getTime() - DEFAULT_RANGE_MS).toISOString(),
    to,
    q: '',
    scope: 'all',
    level: 'all',
    source: 'all',
    filters: {},
    limit: DEFAULT_LIMIT,
    cursor: null,
    focus: 'all',
  };
}

export function parseLogSearch(params: URLSearchParams, fallback = defaultLogSearch()): LogSearch {
  const filters = { ...fallback.filters };
  for (const key of LEGACY_FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  const from = params.get('from') || fallback.from;
  const to = params.get('to') || fallback.to;
  return {
    from: iso(from),
    to: iso(to),
    q: params.get('q') || fallback.q,
    scope: validScope(params.get('scope')),
    level: validLevel(params.get('level'), fallback.level),
    source: validSource(params.get('source'), fallback.source),
    filters,
    limit: validLimit(params.get('limit')),
    cursor: params.get('cursor'),
    focus: validFocus(params.get('focus')),
  };
}

export function toLogSearchParams(search: LogSearch) {
  const params = new URLSearchParams();
  params.set('from', search.from);
  params.set('to', search.to);
  if (search.q) params.set('q', search.q);
  if (search.scope !== 'all') params.set('scope', search.scope);
  if (search.level !== 'all') params.set('level', search.level);
  if (search.source !== 'all') params.set('source', search.source);
  if (search.limit !== DEFAULT_LIMIT) params.set('limit', String(search.limit));
  if (search.cursor) params.set('cursor', search.cursor);
  if (search.focus !== 'all') params.set('focus', search.focus);
  for (const key of LOG_SEARCH_FILTER_KEYS) {
    const value = search.filters[key];
    if (value) params.set(key, value);
  }
  return params;
}

export function draftFromSearch(search: LogSearch): LogSearchDraft {
  return { ...search, cursor: null, filters: { ...search.filters } };
}

export function searchWith(search: LogSearch, patch: Partial<LogSearch>): LogSearch {
  return {
    ...search,
    ...patch,
    filters: patch.filters ? { ...patch.filters } : { ...search.filters },
  };
}

export function resetToFirstPage(search: LogSearch): LogSearch {
  return { ...search, cursor: null };
}
