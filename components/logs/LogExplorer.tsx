'use client';

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { LogDetail, LogExplorerSnapshot, LogRecord, LogSearch } from '@/lib/observability/log-search-contract';
import { defaultLogSearch, draftFromSearch, parseLogSearch, resetToFirstPage, searchWith, toLogSearchParams } from '@/lib/observability/log-search-contract';
import { createExplorerState, explorerReducer, selectedRow } from './log-explorer-state';
import LogQueryBar from './LogQueryBar';
import LogTimeline from './LogTimeline';
import LogFacets from './LogFacets';
import LogStream from './LogStream';
import LogInspector from './LogInspector';
import { CATEGORY_LABELS } from './log-detail-formatters';

function toApiParams(search: LogSearch) {
  const params = toLogSearchParams(search);
  params.set('limit', String(search.limit));
  for (const [key, value] of Object.entries(search.filters)) if (value) params.set(key, value);
  return params;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : '日志查询失败，请稍后重试';
}

export default function LogExplorer({ initialSnapshot, initialSearch, initialError }: { initialSnapshot: LogExplorerSnapshot | null; initialSearch: LogSearch; initialError: string }) {
  const [state, dispatch] = useReducer(explorerReducer, createExplorerState(initialSearch, initialSnapshot, initialError));
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const cursorHistoryRef = useRef<Array<string | null>>([]);
  const deskRef = useRef<HTMLElement | null>(null);
  const row = selectedRow(state);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [queryCollapsed, setQueryCollapsed] = useState(false);
  const scrollStateRef = useRef(false);
  const isQueryCollapsed = hasScrolled && queryCollapsed;

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = Math.max(window.scrollY, document.body.scrollTop, document.documentElement.scrollTop);
      const next = scrollTop > 48;
      if (next === scrollStateRef.current) return;
      scrollStateRef.current = next;
      setHasScrolled(next);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  useLayoutEffect(() => {
    const desk = deskRef.current;
    const query = desk?.querySelector<HTMLElement>('[data-log-query]');
    if (!desk || !query) return undefined;

    // Keep the fixed inspector below the rendered query instead of assuming a chip count.
    // 基于查询栏实际高度定位固定详情面板，避免筛选 chips 换行后被遮挡。
    const updateContextTop = () => {
      const measured = query.getBoundingClientRect().bottom + 12;
      const fallback = isQueryCollapsed ? 148 : 352;
      desk.style.setProperty('--log-context-top', `${Math.max(fallback, measured)}px`);
    };
    const observer = new ResizeObserver(updateContextTop);
    observer.observe(query);
    updateContextTop();
    window.addEventListener('resize', updateContextTop);
    window.addEventListener('scroll', updateContextTop, { passive: true });
    document.addEventListener('scroll', updateContextTop, { passive: true, capture: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateContextTop);
      window.removeEventListener('scroll', updateContextTop);
      document.removeEventListener('scroll', updateContextTop, true);
      desk.style.removeProperty('--log-context-top');
    };
  }, [isQueryCollapsed]);

  const loadSearch = useCallback(async (search: LogSearch, history: 'push' | 'none' = 'push') => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    detailRequestIdRef.current += 1;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: 'applySearch', search });
    try {
      const response = await fetch(`/api/observability/logs?${toApiParams(search).toString()}`, { signal: controller.signal });
      const body = await response.json() as { ok?: boolean; error?: string } & Record<string, unknown>;
      if (!response.ok || !body.ok) throw new Error(body.error || '日志查询失败');
      if (requestId !== requestIdRef.current) return;
      const snapshot = body as unknown as LogExplorerSnapshot;
      dispatch({ type: 'snapshotLoaded', search, snapshot });
      if (history === 'push') window.history.pushState(null, '', `/admin/logs?${toLogSearchParams(search).toString()}`);
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      dispatch({ type: 'loadFailed', error: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const search = parseLogSearch(new URLSearchParams(window.location.search), defaultLogSearch());
      cursorHistoryRef.current = [];
      loadSearch(search, 'none');
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      abortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, [loadSearch]);

  async function loadDetail(nextRow: LogRecord) {
    detailRequestIdRef.current += 1;
    const detailRequestId = detailRequestIdRef.current;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    dispatch({ type: 'selectRow', id: nextRow.id });
    try {
      const response = await fetch(`/api/observability/logs/${encodeURIComponent(nextRow.id)}`, { signal: controller.signal });
      const body = await response.json() as { ok?: boolean; error?: string; detail?: LogDetail };
      if (!response.ok || !body.ok || !body.detail) throw new Error(body.error || '详情读取失败');
      if (detailRequestId !== detailRequestIdRef.current) return;
      dispatch({ type: 'detailLoaded', detail: body.detail });
    } catch (error) {
      if (controller.signal.aborted || detailRequestId !== detailRequestIdRef.current) return;
      dispatch({ type: 'detailFailed', error: errorMessage(error) });
    }
  }

  function runDraft() {
    cursorHistoryRef.current = [];
    loadSearch({ ...state.draft, cursor: null, filters: { ...state.draft.filters } });
  }

  function reset() {
    cursorHistoryRef.current = [];
    const search = defaultLogSearch();
    dispatch({ type: 'editDraft', patch: draftFromSearch(search) });
    loadSearch(search);
  }

  function applySearchPatch(patch: Partial<LogSearch>) {
    cursorHistoryRef.current = [];
    loadSearch(resetToFirstPage(searchWith(state.draft, patch)));
  }

  function setPreset(minutes: number) {
    const to = new Date();
    const next = { from: new Date(to.getTime() - minutes * 60_000).toISOString(), to: to.toISOString() };
    dispatch({ type: 'editDraft', patch: next });
    cursorHistoryRef.current = [];
    loadSearch(resetToFirstPage(searchWith(state.draft, next)));
  }

  function expandRange() {
    setPreset(60);
  }

  function selectBucket(bucket: { bucket: string; total: number }) {
    const from = new Date(bucket.bucket);
    const seconds = state.snapshot?.bucketSeconds || 60;
    const to = new Date(from.getTime() + seconds * 1_000);
    applySearchPatch({ from: from.toISOString(), to: to.toISOString() });
  }

  function nextPage() {
    const cursor = state.snapshot?.page.nextCursor;
    if (!cursor) return;
    cursorHistoryRef.current.push(state.applied.cursor);
    loadSearch({ ...state.applied, cursor });
  }

  function previousPage() {
    const cursor = cursorHistoryRef.current.pop();
    if (cursor === undefined) return;
    loadSearch({ ...state.applied, cursor });
  }

  function updateFilter(key: 'service' | 'event' | 'traceId' | 'requestId' | 'taskId', value: string) {
    applySearchPatch({ filters: { ...state.draft.filters, [key]: value } });
  }

  function closeDetail() {
    detailRequestIdRef.current += 1;
    detailAbortRef.current?.abort();
    dispatch({ type: 'clearSelection' });
  }

  const facets = state.snapshot?.facets || { category: [], level: [], source: [], service: [], event: [] };
  const summary = state.snapshot?.summary;
  return (
    <main ref={deskRef} className={`log-desk ${row ? 'has-inspector' : ''} ${isQueryCollapsed ? 'has-collapsed-query' : ''}`}>
      <header className="log-desk__header">
        <div><span className="log-desk__eyebrow">OBSERVABILITY CONSOLE</span><h1>日志检索</h1><p>按类别、请求、任务和完整上下文定位一次异常，不再在混杂的运行日志里猜字段。</p></div>
        <nav><a href="/admin/reports">服务监控报表</a><a href="/admin">管理后台</a></nav>
      </header>
      <LogQueryBar draft={state.draft} applied={state.applied} loading={state.requestState === 'loading'} isCollapsed={isQueryCollapsed} showToggle={hasScrolled} onToggle={() => setQueryCollapsed((value) => !value)} onDraftChange={(patch) => dispatch({ type: 'editDraft', patch })} onRun={runDraft} onReset={reset} onScopeChange={(scope) => applySearchPatch({ scope })} onFocusChange={(focus) => applySearchPatch({ focus })} onPreset={setPreset} />
      {state.error && <div className="log-desk__alert" role="alert">{state.error}</div>}
      <div className="log-desk__overview"><span>{summary?.total || 0} 条命中</span><span>{summary?.byCategory.api || 0} {CATEGORY_LABELS.api} · {summary?.byCategory.api_runtime || 0} {CATEGORY_LABELS.api_runtime} · {summary?.byCategory.browser || 0} {CATEGORY_LABELS.browser} · {summary?.byCategory.infrastructure || 0} {CATEGORY_LABELS.infrastructure} · {summary?.byCategory.other || 0} {CATEGORY_LABELS.other}</span></div>
      <LogTimeline timeline={state.snapshot?.timeline || []} onBucketSelect={selectBucket} onExpand={expandRange} />
      <div className="log-desk__body">
        <LogFacets facets={facets} scope={state.applied.scope} level={state.applied.level} source={state.applied.source} filters={state.applied.filters} onCategory={(scope) => applySearchPatch({ scope })} onLevel={(level) => applySearchPatch({ level: level as LogSearch['level'] })} onSource={(source) => applySearchPatch({ source: source as LogSearch['source'] })} onFilter={updateFilter} />
        <LogStream rows={state.snapshot?.rows || []} total={summary?.total || 0} hasMore={state.snapshot?.page.hasMore || false} focus={state.applied.focus} selectedId={state.selectedId} onSelect={loadDetail} onFilter={updateFilter} onNextPage={nextPage} onPreviousPage={previousPage} canPrevious={cursorHistoryRef.current.length > 0} />
        <LogInspector row={row} state={state.detail} onClose={closeDetail} onRetry={() => row && loadDetail(row)} />
      </div>
    </main>
  );
}
