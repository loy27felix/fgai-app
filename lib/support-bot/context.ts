import type { SupportRuntimeSnapshot } from './runtime';

export type SupportBrowserRequest = {
  id: string; occurredAt: string; route: string; httpStatus?: number; errorCode?: string;
  requestId?: string; traceId?: string; taskId?: string; projectId?: string; durationMs?: number;
};
export type SupportContext = {
  source: 'fg' | 'canvas';
  pagePath?: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  requestId?: string;
  traceId?: string;
  occurredFrom?: string;
  occurredTo?: string;
  browserRequests?: SupportBrowserRequest[];
  runtime?: SupportRuntimeSnapshot;
};

// Context from the browser is a search hint, never identity or version authority.
// 浏览器上下文仅用于定位，不作为身份或运行版本的可信来源。
export function parseSupportContext(value: unknown): SupportContext {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const context: SupportContext = { source: input.source === 'canvas' ? 'canvas' : 'fg' };
  if (typeof input.pagePath === 'string' && /^\/(?!\/)[^?#\x00-\x20]{0,499}$/.test(input.pagePath)) context.pagePath = input.pagePath;
  for (const key of ['projectId', 'taskId', 'sessionId', 'requestId', 'traceId'] as const) {
    if (typeof input[key] === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(input[key])) context[key] = input[key];
  }
  if (input.occurredFrom !== undefined || input.occurredTo !== undefined) {
    const range = supportTimeRange(input.occurredFrom, input.occurredTo);
    if (!range) throw new Error('发生时间段无效，请选择带时区且不超过7天的完整时间范围');
    context.occurredFrom = range.from;
    context.occurredTo = range.to;
  }
  if (context.source === 'canvas' && Array.isArray(input.browserRequests)) {
    const now = Date.now();
    const from = context.occurredFrom ? Date.parse(context.occurredFrom) : now - 15 * 60000;
    const to = context.occurredTo ? Date.parse(context.occurredTo) : now + 60000;
    context.browserRequests = input.browserRequests.slice(0, 20).flatMap(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(row.id)
        || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))
        || Date.parse(row.occurredAt) < from || Date.parse(row.occurredAt) > to
        || typeof row.route !== 'string' || !/^\/(?!\/)[A-Za-z0-9_./:%-]{0,399}$/.test(row.route)
        || /(?:support-bot|observability|diagnostics|auth|token|share|public|secret|password|api-key)/i.test(row.route)) return [];
      const item: SupportBrowserRequest = { id: row.id, occurredAt: new Date(row.occurredAt).toISOString(), route: row.route };
      for (const key of ['taskId', 'requestId', 'traceId', 'projectId'] as const) {
        if (typeof row[key] === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(row[key])) item[key] = row[key];
      }
      if (typeof row.errorCode === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(row.errorCode)) item.errorCode = row.errorCode;
      if (typeof row.httpStatus === 'number' && Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599) item.httpStatus = row.httpStatus;
      if (typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 0 && row.durationMs <= 86400000) item.durationMs = Math.round(row.durationMs);
      return [item];
    });
  }
  return context;
}

export function supportTimeRange(from: unknown, to: unknown): { from: string; to: string } | undefined {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof from !== 'string' || typeof to !== 'string' || !iso.test(from) || !iso.test(to)) return undefined;
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 7 * 86400000) return undefined;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}
