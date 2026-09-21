import type { LogCategory, LogDetail, LogRecord } from '@/lib/observability/log-search-contract';

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  browser: '浏览器日志',
  api: 'API 日志',
  api_runtime: 'API 运行日志',
  infrastructure: '基建日志',
  other: '其他来源',
};

export function categoryLabel(category: LogCategory) {
  return CATEGORY_LABELS[category] || '其他来源';
}

export function statusText(row: LogRecord) {
  if (row.httpStatus === null) return 'HTTP —';
  return `HTTP ${row.httpStatus}`;
}

export function rowSummary(row: LogRecord) {
  if (row.category === 'api') return `${row.route || row.event} · ${statusText(row)}${row.durationMs === null ? '' : ` · ${row.durationMs} ms`}`;
  if (row.category === 'browser') return row.message || `${row.service} · ${row.event}`;
  if (row.category === 'infrastructure') return `${row.service} · ${row.message || row.event}`;
  return row.message || `${row.service} · ${row.event}`;
}

function text(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function detailFields(detail: LogDetail) {
  const request = detail.details.request && typeof detail.details.request === 'object' ? detail.details.request as Record<string, unknown> : {};
  const fields: Array<[string, string]> = [
    ['类别', categoryLabel(detail.category)],
    ['来源', detail.source],
    ['服务', detail.service],
    ['事件', detail.event],
    ['级别', detail.level],
    ['结果', detail.outcome],
    ['时间', detail.occurredAt],
    ['Trace ID', detail.traceId || '—'],
    ['Request ID', detail.requestId || '—'],
    ['Task ID', detail.taskId || '—'],
    ['用户 ID', detail.userId || '—'],
    ['操作者', detail.actorEmail || '—'],
    ['路由', detail.route || '—'],
    ['HTTP 状态', detail.httpStatus === null ? '—' : String(detail.httpStatus)],
    ['耗时', detail.durationMs === null ? '—' : `${detail.durationMs} ms`],
  ];
  if (detail.category === 'browser') fields.push(['浏览器上下文', text(detail.details.browser || detail.details.userAgent || detail.details.page)]);
  if (detail.category === 'api') fields.push(['HTTP 方法', text(detail.details.method || request.method)]);
  if (detail.category === 'infrastructure') fields.push(['主机/组件', text(detail.details.host || detail.details.component || detail.service)]);
  return fields;
}

export function jsonText(detail: LogDetail) {
  return JSON.stringify(detail.details, null, 2) || '{}';
}
