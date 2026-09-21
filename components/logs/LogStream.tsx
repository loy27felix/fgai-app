'use client';

import type { LogRecord, LogFocus } from '@/lib/observability/log-search-contract';
import { categoryLabel, rowSummary, statusText } from './log-detail-formatters';

const CATEGORY_ORDER = { api: 0, api_runtime: 1, browser: 2, infrastructure: 3, other: 4 } as const;

function timeText(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

export default function LogStream({ rows, total, hasMore, focus, selectedId, onSelect, onFilter, onNextPage, onPreviousPage, canPrevious }: {
  rows: LogRecord[];
  total: number;
  hasMore: boolean;
  focus: LogFocus;
  selectedId: string | null;
  onSelect: (row: LogRecord) => void;
  onFilter: (key: 'traceId' | 'requestId' | 'taskId', value: string) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  canPrevious: boolean;
}) {
  const visibleRows = focus === 'app-first'
    ? [...rows].sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category])
    : rows;
  return (
    <section className="log-desk__stream" aria-label="日志事件流">
      <div className="log-desk__stream-head">
        <div><span className="log-desk__eyebrow">LOG STREAM</span><h2>日志事件流</h2></div>
        <span className="log-desk__stream-count">{rows.length} / {total} 条 · {focus === 'app-first' ? '当前页应用优先' : '时间顺序'}</span>
      </div>
      {rows.length === 0 ? (
        <div className="log-desk__stream-empty"><strong>没有匹配日志</strong><span>请扩大时间范围或清除一个筛选条件。</span></div>
      ) : (
        <div className="log-desk__table-wrap">
          <div className="log-desk__table-head"><span>时间</span><span>类别 / 级别</span><span>服务 / 事件</span><span>Route / HTTP / 耗时</span><span>Trace / Request / Task</span><span>摘要</span></div>
          {visibleRows.map((row) => (
            <div key={row.id} className={`log-desk__row ${selectedId === row.id ? 'is-selected' : ''}`} role="button" tabIndex={0} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row); } }}>
              <span className="log-desk__time">{timeText(row.occurredAt)}</span>
              <span className={`log-desk__level log-desk__level--${row.level}`}><b>{categoryLabel(row.category)}</b><em>{row.level}</em></span>
              <span className="log-desk__service"><strong>{row.service || '—'}</strong><small>{row.event || '—'}</small></span>
              <span className="log-desk__route"><strong>{row.route || row.event || '—'}</strong><small>{statusText(row)}{row.durationMs === null ? '' : ` · ${row.durationMs} ms`}</small></span>
              <span className="log-desk__correlation">
                {row.traceId && <button type="button" className="log-desk__correlation-link" onClick={(event) => { event.stopPropagation(); onFilter('traceId', row.traceId as string); }}>T {row.traceId.slice(0, 16)}…</button>}
                {row.requestId && <button type="button" className="log-desk__correlation-link" onClick={(event) => { event.stopPropagation(); onFilter('requestId', row.requestId as string); }}>R {row.requestId.slice(0, 16)}…</button>}
                {row.taskId && <button type="button" className="log-desk__correlation-link" onClick={(event) => { event.stopPropagation(); onFilter('taskId', row.taskId as string); }}>K {row.taskId.slice(0, 16)}…</button>}
                {!row.traceId && !row.requestId && !row.taskId && '—'}
              </span>
              <span className="log-desk__summary"><strong>{rowSummary(row)}</strong><small>{row.source} · {row.actorEmail || 'system'}</small></span>
            </div>
          ))}
        </div>
      )}
      <div className="log-desk__pagination"><span>每页 50 条，当前结果 {total} 条</span><div><button type="button" onClick={onPreviousPage} disabled={!canPrevious}>上一页</button><button type="button" onClick={onNextPage} disabled={!hasMore}>下一页</button></div></div>
    </section>
  );
}
