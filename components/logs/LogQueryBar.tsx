'use client';

import { useEffect, useRef } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { DatePicker } from 'antd';
import type { LogCategory, LogSearch, LogSearchDraft, LogScope } from '@/lib/observability/log-search-contract';

const PRESETS = [
  ['15m', '近 15 分钟', 15],
  ['1h', '近 1 小时', 60],
  ['6h', '近 6 小时', 360],
  ['24h', '近 24 小时', 1_440],
  ['7d', '近 7 天', 10_080],
] as const;

const SCOPES: Array<{ value: LogScope; label: string; short: string }> = [
  { value: 'all', label: '全部来源', short: '全部' },
  { value: 'browser', label: '浏览器日志', short: '浏览器' },
  { value: 'api', label: 'API 日志', short: 'API' },
  { value: 'api_runtime', label: 'API 运行日志', short: '运行' },
  { value: 'infrastructure', label: '基建日志', short: '基建' },
  { value: 'other', label: '其他来源', short: '其他' },
];

function rangeValue(search: LogSearchDraft): [Dayjs, Dayjs] {
  return [dayjs(search.from), dayjs(search.to)];
}

function labelForFilter(key: string) {
  const labels: Record<string, string> = { service: '服务', event: '事件', route: '路由', outcome: '结果', traceId: 'Trace', requestId: 'Request', taskId: 'Task', userId: '用户', actorEmail: '操作者', httpStatus: 'HTTP', httpStatusGte: 'HTTP ≥', httpStatusLte: 'HTTP ≤', durationMs: '耗时', durationMsGte: '耗时 ≥', durationMsLte: '耗时 ≤' };
  return labels[key] || key;
}

export default function LogQueryBar({
  draft,
  applied,
  loading,
  onDraftChange,
  onRun,
  onReset,
  onScopeChange,
  onFocusChange,
  onPreset,
  isCollapsed,
  showToggle,
  onToggle,
}: {
  draft: LogSearchDraft;
  applied: LogSearch;
  loading: boolean;
  onDraftChange: (patch: Partial<LogSearchDraft>) => void;
  onRun: () => void;
  onReset: () => void;
  onScopeChange: (scope: LogScope) => void;
  onFocusChange: (focus: 'all' | 'app-first') => void;
  onPreset: (minutes: number) => void;
  isCollapsed: boolean;
  showToggle: boolean;
  onToggle: () => void;
}) {
  const collapsedToggleRef = useRef<HTMLButtonElement>(null);
  const expandedToggleRef = useRef<HTMLButtonElement>(null);
  const draftFilters = Object.entries(draft.filters).filter(([, value]) => value);
  const appliedFilters = Object.entries(applied.filters).filter(([, value]) => value);
  const hasDraftChanges = draft.q !== applied.q
    || draft.scope !== applied.scope
    || draft.level !== applied.level
    || draft.focus !== applied.focus
    || draft.from !== applied.from
    || draft.to !== applied.to
    || JSON.stringify(draft.filters) !== JSON.stringify(applied.filters);

  useEffect(() => {
    const toggle = isCollapsed ? collapsedToggleRef.current : expandedToggleRef.current;
    toggle?.focus();
  }, [isCollapsed]);

  function updateRange(values: null | [Dayjs | null, Dayjs | null]) {
    if (!values?.[0] || !values[1]) return;
    onDraftChange({ from: values[0].toISOString(), to: values[1].toISOString() });
  }

  function removeFilter(key: string) {
    const filters = { ...draft.filters };
    delete filters[key as keyof typeof filters];
    onDraftChange({ filters });
  }

  return (
    <section className={`log-desk__query ${isCollapsed ? 'is-collapsed' : ''}`} data-log-query="true" aria-label="日志查询条件">
      {isCollapsed && (
        <div className="log-desk__query-collapsed">
          <span className="log-desk__query-mark">SLS</span>
          <div className="log-desk__query-summary">
            <strong>已应用</strong>
            <span className="is-applied">{applied.scope === 'all' ? '全部类别' : SCOPES.find((scope) => scope.value === applied.scope)?.label}</span>
            <span className="is-applied">{dayjs(applied.from).format('MM-DD HH:mm')} — {dayjs(applied.to).format('MM-DD HH:mm')}</span>
            <span className="is-applied">{applied.level === 'all' ? '全部级别' : applied.level}</span>
            <span className="is-applied">{applied.focus === 'app-first' ? '应用优先' : '时间顺序'}</span>
            {appliedFilters.length > 0 && <span className="is-applied is-filter">{appliedFilters.length} 个筛选：{appliedFilters.map(([key, value]) => `${labelForFilter(key)}:${value}`).join(' · ')}</span>}
            {applied.q && <span className="is-applied is-query">{applied.q}</span>}
            {hasDraftChanges && <span className="is-draft">有待运行条件</span>}
          </div>
          <button ref={collapsedToggleRef} className="log-desk__query-toggle" type="button" onClick={onToggle} aria-expanded={false} aria-controls="log-query-content">展开查询</button>
        </div>
      )}
      <div id="log-query-content" hidden={isCollapsed}>
        <div className="log-desk__query-main">
        <span className="log-desk__query-mark">SLS</span>
        <input
          id="log-search"
          className="log-desk__query-input"
          value={draft.q}
          onChange={(event) => onDraftChange({ q: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') onRun(); }}
          placeholder="输入查询，例如 category:api status>=500 route:/api/..."
          aria-label="日志搜索"
        />
        <button className="log-desk__run" type="button" onClick={onRun} disabled={loading}>
          {loading ? '查询中…' : '运行查询'}
          <span aria-hidden="true">→</span>
        </button>
        </div>
        <div className="log-desk__query-help">
          <span>field:value</span> 精确筛选，<span>status&gt;=500</span> 数值范围，裸词按全文检索。默认展示全部类别。
        </div>
        <div className="log-desk__query-meta">
        <DatePicker.RangePicker
          value={rangeValue(draft)}
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          allowClear={false}
          onChange={updateRange}
          aria-label="日志时间范围"
        />
        <label className="log-desk__select-label">
          <span>级别</span>
          <select value={draft.level} onChange={(event) => onDraftChange({ level: event.target.value as LogSearchDraft['level'] })}>
            <option value="all">全部级别</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <span className="log-desk__query-state">{hasDraftChanges ? '有待运行条件' : `已应用 · ${applied.scope === 'all' ? '全部类别' : applied.scope}`}</span>
        <button className="log-desk__reset" type="button" onClick={onReset}>重置</button>
        {showToggle && <button ref={expandedToggleRef} className="log-desk__query-toggle" type="button" onClick={onToggle} aria-expanded={true} aria-controls="log-query-content">收起查询</button>}
        </div>
        <div className="log-desk__scope-row" aria-label="日志类别">
        {SCOPES.map((scope) => (
          <button key={scope.value} type="button" className={draft.scope === scope.value ? 'is-active' : ''} aria-pressed={draft.scope === scope.value} onClick={() => onScopeChange(scope.value)} title={scope.label}>
            {scope.short}
          </button>
        ))}
        <span className="log-desk__focus-label">焦点</span>
        <button type="button" className={draft.focus === 'all' ? 'is-active' : ''} aria-pressed={draft.focus === 'all'} onClick={() => onFocusChange('all')}>时间顺序</button>
        <button type="button" className={draft.focus === 'app-first' ? 'is-active' : ''} aria-pressed={draft.focus === 'app-first'} onClick={() => onFocusChange('app-first')}>当前页应用优先</button>
        </div>
        <div className="log-desk__preset-row">
        {PRESETS.map(([key, label, minutes]) => (
          <button key={key} type="button" onClick={() => onPreset(minutes)}>{label}</button>
        ))}
        </div>
      {draftFilters.length > 0 && (
          <div className="log-desk__chips" aria-label="结构化筛选条件">
          {draftFilters.map(([key, value]) => (
            <button key={key} type="button" onClick={() => removeFilter(key)} title="移除条件">
              {labelForFilter(key)}:{value}<span aria-hidden="true">×</span>
            </button>
          ))}
          </div>
        )}
      </div>
    </section>
  );
}
