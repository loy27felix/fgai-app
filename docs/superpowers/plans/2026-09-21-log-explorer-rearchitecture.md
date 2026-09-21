# 日志检索工作台重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/admin/logs` 重构为支持 SLS 查询、四类日志分类、全量 Facet、稳定 cursor 分页和逐条详情检查的高密度日志工作台。

**Architecture:** 后端继续使用四条持久化事件流的统一 SQL CTE，但在查询层一次性归一化 `category`、Facet、时间线和列表摘要。前端以 URL 表示唯一 applied query，React 只维护草稿、请求生命周期、结果快照和选中日志，并拆分查询栏、时间线、Facet、日志流和详情检查器。

**Tech Stack:** Next.js 14 App Router、React、TypeScript、PostgreSQL、Ant Design DatePicker、现有全局 CSS token。

**Spec:** `docs/superpowers/specs/2026-09-21-log-explorer-rearchitecture-design.md`

## Global Constraints

- 默认 `scope=all`，四个主类别和 `other` 扩展类别都可见；`focus=app-first` 只改变排序/分组，不过滤日志。
- 日志类别固定为 `browser`、`api`、`api_runtime`、`infrastructure`，无法归类的 audit/provider/billing/data 等进入 `other`，始终保留真实 `source`。
- SLS 已知字段、数值比较、裸词 AND、未知字段兼容和非法比较 400 语义必须保持并扩展到 `category`。
- URL 是 applied query 唯一事实；草稿未运行前不得污染结果、URL、Facet 或分页。
- 只保留 keyset cursor；任何改变筛选、时间、类别、Facet 或焦点的动作都清 cursor 并回到第一页。
- 每条日志都必须能打开详情检查器，展示规范化字段、关联 ID、类别专属字段和完整脱敏 JSON，并支持复制与详情失败重试。
- 不修改已执行 migration；除非验证发现必要索引，否则本计划不新增 migration。
- 不自动生成测试代码；每个任务使用 TypeScript、SQL/脚本语法、git diff 和本地运行时检查验证。
- 遵守项目中文沟通、KISS、YAGNI、双语非直觉注释和不引入重复 UI 依赖约束。

---

### Task 1: 建立统一查询契约与 canonical category 类型

**Files:**
- Create: `lib/observability/log-search-contract.ts`
- Modify: `lib/observability/log-query.ts:1-140`
- Modify: `app/admin/logs/page.tsx:1-78`
- Delete: `components/ObservabilityLogExplorer.tsx`（删除前端旧单体入口，后续任务提供新入口）

**Interfaces:**
- Produces `LogCategory = 'browser' | 'api' | 'api_runtime' | 'infrastructure' | 'other'`。
- Produces `LogScope = 'all' | LogCategory`、`LogFocus = 'all' | 'app-first'`。
- Produces `LogSearch`, `LogSearchDraft`, `LogFacet`, `LogExplorerSnapshot`, `defaultLogSearch()`, `parseLogSearch(params)`, `toLogSearchParams(search)`。
- `LogExplorerSnapshot.rows` uses list-safe `LogRecord` with optional `details`; full details are loaded by Task 2.

- [ ] **Step 1: Define canonical serializable types and defaults**

  In `lib/observability/log-search-contract.ts`, define:

  ```ts
  export type LogCategory = 'browser' | 'api' | 'api_runtime' | 'infrastructure' | 'other';
  export type LogScope = 'all' | LogCategory;
  export type LogFocus = 'all' | 'app-first';
  export type LogSearch = {
    from: string;
    to: string;
    q: string;
    scope: LogScope;
    level: LogLevelFilter;
    filters: StructuredFilters;
    limit: 50 | 100 | 200;
    cursor: string | null;
    focus: LogFocus;
  };
  export type LogSearchDraft = Omit<LogSearch, 'cursor'> & { cursor: null };
  ```

  Keep the existing structured fields in `StructuredFilters`; add `category` only to the SLS parser/scope path so category is not duplicated in both q and URL filter fields.

- [ ] **Step 2: Implement URL parsing and serialization**

  `parseLogSearch` must normalize absent values to a 15-minute range, `scope=all`, `level=all`, `focus=all`, `limit=50`, and `cursor=null`. It must accept legacy `source`, `offset`, and structured query parameters without placing `offset` in the resulting search. `toLogSearchParams` must omit defaults, preserve all non-default filters, and include cursor/limit for copyable pagination URLs.

- [ ] **Step 3: Add category parsing and normalization hooks**

  Extend `NormalizedLogQuery` with `scope` and `focus`, validate category values with `LogQueryValidationError`, and add `category` to `LogRecord`. Keep source values independent from category so `other` rows retain their real source.

- [ ] **Step 4: Replace page initial props with the contract**

  Change `app/admin/logs/page.tsx` to parse one `LogSearch`, call `queryLogExplorer` with it, and pass `{ initialSnapshot, initialSearch, initialError }` to the new `LogExplorer` entry point. Do not duplicate structured filter extraction in the page.

- [ ] **Step 5: Run static verification**

  Run `pnpm exec tsc --noEmit --pretty false --incremental false`.

  Expected: this task may fail until Task 3 adds the new query return shape; record the exact missing imports/types and resolve them before committing.

- [ ] **Step 6: Commit**

  ```bash
  git add lib/observability/log-search-contract.ts lib/observability/log-query.ts app/admin/logs/page.tsx components/ObservabilityLogExplorer.tsx
  git commit -m "refactor(observability): add canonical log search contract"
  ```

### Task 2: Add per-log detail retrieval and category-aware SQL normalization

**Files:**
- Modify: `lib/observability/log-query.ts`
- Modify: `app/api/observability/logs/route.ts`
- Create: `app/api/observability/logs/[id]/route.ts`
- Modify: `lib/observability/server-log.ts` only if the detail route needs the existing failure logger import shape adjusted

**Interfaces:**
- Produces `queryLogExplorer(search: LogSearch): Promise<LogExplorerSnapshot>`.
- Produces `getLogDetail(id: string): Promise<LogDetail | null>` where `LogDetail` contains all normalized fields plus `details: Record<string, unknown>`.
- API list route returns `{ ok: true, ...snapshot }`; detail route returns `{ ok: true, detail }`, 404 for unknown IDs, and existing 401/403/500 auth/error semantics.

- [ ] **Step 1: Define one SQL category expression**

  Add a `category` expression to the shared `logs` CTE. The expression must classify `frontend` as `browser`, HTTP receive/exchange events or `app` HTTP services as `api`, remaining `app` events as `api_runtime`, `infra`/`deploy` and NAS/tunnel/nginx services/events as `infrastructure`, and remaining sources as `other`. Use the same expression for list, summary, timeline, facets, and detail lookup.

- [ ] **Step 2: Replace offset-first pagination with cursor-only pagination**

  Normalize requests with a cursor and always query `limit + 1` rows ordered by `occurred_at desc, sequence_id desc, id desc`. Return only `{ hasMore, nextCursor }`; ignore legacy offset after converting it to the first page.

- [ ] **Step 3: Implement full-result Facets**

  Return `facets.category`, `facets.level`, `facets.source`, `facets.service`, and `facets.event`. Each facet query must reuse the normalized scope and filters while removing only its own dimension so switching a category/source remains possible. Counts must come from the full filtered result, not the current page.

- [ ] **Step 4: Make list rows summary-safe**

  Return category, occurredAt, source, service, event, level, outcome, message, route, status, duration, and correlation IDs in each row. Do not require the list layout to inspect arbitrary `details`; either omit details or include only a bounded summary object.

- [ ] **Step 5: Implement `getLogDetail` and the detail route**

  Parse IDs such as `audit:123`, `log:123`, `error:123`, and `service:123` without interpolating them into SQL. Query only the matching CTE row, return full already-persisted/declassified details, and reject unknown prefixes with 404. Detail errors must remain local to the inspector.

- [ ] **Step 6: Verify backend contract**

  Run:

  ```bash
  pnpm exec tsc --noEmit --pretty false --incremental false
  node --check scripts/local-db-migrate.mjs
  git diff --check
  ```

  With a logged-in local browser session, verify `scope=all`, each category scope, `category:api status>=500`, an invalid category 400, first-page `nextCursor`, next-page stability, and one detail request for each persisted ID prefix.

- [ ] **Step 7: Commit**

  ```bash
  git add lib/observability/log-query.ts app/api/observability/logs/route.ts app/api/observability/logs/[id]/route.ts
  git commit -m "feat(observability): expose categorized log snapshots and details"
  ```

### Task 3: Implement reducer-driven explorer orchestration

**Files:**
- Create: `components/logs/LogExplorer.tsx`
- Modify: `app/admin/logs/page.tsx`
- Create: `components/logs/log-explorer-state.ts`

**Interfaces:**
- `LogExplorer` accepts `{ initialSnapshot, initialSearch, initialError }`.
- `loadSnapshot(search: LogSearch): Promise<void>` owns AbortController, request sequence, URL sync, and latest-response checks.
- Child components receive immutable snapshot data and callbacks; they never mutate URL or call the API directly.

- [ ] **Step 1: Define reducer state and actions**

  Use `draft`, `applied`, `snapshot`, `selectedId`, `detail`, `requestState`, and `error`. Add actions for `editDraft`, `applySearch`, `snapshotLoaded`, `loadFailed`, `selectRow`, `detailLoaded`, `detailFailed`, and `clearSelection`.

- [ ] **Step 2: Add latest-request protection**

  Keep one `AbortController` ref and monotonically increasing request ID. Abort the previous request before a new load; only the latest ID may write snapshot, loading, error, or URL. On failure, retain the last good snapshot and mark the error as query or detail-local.

- [ ] **Step 3: Wire browser history**

  Serialize `applied` with `toLogSearchParams` after successful list loads. Register `popstate` to parse the URL and load that search. Do not encode selected detail in the URL.

- [ ] **Step 4: Add derived actions**

  Implement `runDraft`, `applyScope`, `applyFacet`, `drillIntoBucket`, `applyRowFilter`, `nextPage`, `previousPage`, and `changeLimit`. Each derives from `applied`, clears cursor when the result set changes, and leaves unsubmitted draft values untouched.

- [ ] **Step 5: Verify state transitions manually**

  Run the dev server and use the local browser to confirm: typing without running does not change rows; Facet/time/category actions update applied chips; rapidly clicking two actions leaves the second result; browser Back/Forward restores query and page; detail errors do not clear rows.

- [ ] **Step 6: Commit**

  ```bash
  git add components/logs/LogExplorer.tsx components/logs/log-explorer-state.ts app/admin/logs/page.tsx
  git commit -m "refactor(observability): centralize explorer query state"
  ```

### Task 4: Build the SLS query bar, category tabs, timeline, and Facets

**Files:**
- Create: `components/logs/LogQueryBar.tsx`
- Create: `components/logs/LogTimeline.tsx`
- Create: `components/logs/LogFacets.tsx`
- Modify: `components/logs/LogExplorer.tsx`

**Interfaces:**
- `LogQueryBar` consumes `draft`, `applied`, loading/error state and emits `onDraftChange`, `onRun`, `onReset`, `onScopeChange`, `onFocusChange`, and `onPreset`.
- `LogTimeline` consumes `timeline` and emits `onBucketSelect`.
- `LogFacets` consumes full-result facets and emits `onFacetSelect`.

- [ ] **Step 1: Implement compact SLS query bar**

  Put expression, run button, time range, hit count, scope tabs, focus control, applied chips, and an explicit “待运行” indicator in the query bar. Keep the existing Ant Design RangePicker dependency; do not add a date library.

- [ ] **Step 2: Implement category scope and focus semantics**

  Render four named categories plus “其他来源” and “全部”。Scope changes filter results; `app-first` only changes grouping/order and displays a note that total is unchanged. Do not encode focus as a source or service query.

- [ ] **Step 3: Implement timeline drilldown**

  Render a 48–56px density strip only when data exists, with start/end labels and accessible bucket buttons. Empty results use a compact recovery state with “近 1 小时” and “清除条件” actions.

- [ ] **Step 4: Implement full-result Facets**

  Render category, level, source, service, and event groups with counts labelled “当前查询结果”. Selecting a facet emits a new applied search and clears cursor; do not derive counts from `rows`.

- [ ] **Step 5: Verify query UX**

  Verify SLS examples, invalid-query error persistence, draft/applied separation, category switching, facet counts, timeline bucket narrowing, reset, and compact empty state in the browser.

- [ ] **Step 6: Commit**

  ```bash
  git add components/logs/LogQueryBar.tsx components/logs/LogTimeline.tsx components/logs/LogFacets.tsx components/logs/LogExplorer.tsx
  git commit -m "feat(observability): add SLS query workspace controls"
  ```

### Task 5: Implement category-aware log stream and per-log detail inspector

**Files:**
- Create: `components/logs/LogStream.tsx`
- Create: `components/logs/LogInspector.tsx`
- Create: `components/logs/log-detail-formatters.ts`
- Modify: `components/logs/LogExplorer.tsx`

**Interfaces:**
- `LogStream` consumes `rows`, `page`, `focus`, `selectedId`, and emits `onSelect`, `onFilter`, `onNextPage`, `onPreviousPage`.
- `LogInspector` consumes `selectedRow`, `detailState`, and emits `onClose`, `onRetry`, `onCopy`.
- `formatLogSummary(row)` and `formatLogDetail(category, detail)` return render-safe field groups without assuming a fixed payload shape.

- [ ] **Step 1: Define category-specific row summaries**

  API rows show method/route/status/duration and trace/request IDs; API runtime rows show service/event/outcome/message and task IDs; browser rows show page/agent/user context; infrastructure rows show component/host/event/message; other rows show true source/service/event without relabelling.

- [ ] **Step 2: Implement dense stream rows**

  Use one shared grid definition for header and rows. Keep time and level narrow, service/event and route/status as primary blocks, correlation IDs as mono secondary text, and summary as the widest column. Selecting any row opens the inspector without navigating away.

- [ ] **Step 3: Implement detail loading**

  On selection, call `/api/observability/logs/${encodeURIComponent(row.id)}`. Show loading, local error with retry, and a stable empty state. A detail failure must not alter `snapshot.rows` or pagination.

- [ ] **Step 4: Implement full detail inspector**

  Render common fields, category-specific fields, correlation IDs, HTTP exchange request/response when present, `ingestedAt` if available, and full redacted JSON in a scrollable code block. Add copy controls for IDs and JSON with visible success/error feedback.

- [ ] **Step 5: Verify every category**

  Using local sample data, open one browser, API, API runtime, infrastructure, and other row. Confirm all show detail fields, JSON, copy actions, close/reopen behavior, and detail retry without losing the result list.

- [ ] **Step 6: Commit**

  ```bash
  git add components/logs/LogStream.tsx components/logs/LogInspector.tsx components/logs/log-detail-formatters.ts components/logs/LogExplorer.tsx
  git commit -m "feat(observability): add categorized stream and log details"
  ```

### Task 6: Replace legacy observability styles with a dense log desk

**Files:**
- Modify: `app/globals.css:1282-1462`
- Modify: `components/logs/LogQueryBar.tsx`
- Modify: `components/logs/LogTimeline.tsx`
- Modify: `components/logs/LogFacets.tsx`
- Modify: `components/logs/LogStream.tsx`
- Modify: `components/logs/LogInspector.tsx`

**Interfaces:**
- All log UI uses `.log-desk` descendants and shared CSS variables; no inline grid templates or category-specific hard-coded layout styles remain in JSX.

- [ ] **Step 1: Add scoped log desk tokens**

  Derive `--log-surface`, `--log-rule`, `--log-muted`, `--log-focus`, `--log-danger`, and category accents from existing theme variables inside `.log-desk`.

- [ ] **Step 2: Remove marketing-page treatment**

  Remove the large explorer pseudo-element glows, 48px heading, oversized summary cards, duplicate timeline rules, and legacy `.log-explorer__summary*`/`.log-explorer__chart*` selectors that no longer match the new DOM.

- [ ] **Step 3: Implement responsive three-column layout**

  Use `facet rail (180px) | stream (flex) | inspector (340px when selected)` on desktop; collapse the rail and inspector into accessible drawers on smaller screens. Keep the query bar sticky without clipping the DatePicker popup.

- [ ] **Step 4: Run visual verification**

  In the local browser verify dark/light theme, 1440px dense stream, empty result, selected detail, long message/payload, 820px and 520px responsive states, keyboard focus, and reduced-motion behavior.

- [ ] **Step 5: Commit**

  ```bash
  git add app/globals.css components/logs/LogQueryBar.tsx components/logs/LogTimeline.tsx components/logs/LogFacets.tsx components/logs/LogStream.tsx components/logs/LogInspector.tsx
  git commit -m "style(observability): create dense log desk layout"
  ```

### Task 7: Integrate, verify, and remove stale entry points

**Files:**
- Modify: `app/admin/logs/page.tsx`
- Modify: `docs/superpowers/specs/2026-09-21-log-explorer-rearchitecture-design.md` only if implementation evidence requires a clarified constraint
- Delete: any unused legacy observability explorer CSS or component imports found by `rg`

**Interfaces:**
- `/admin/logs` is the only page entry point and imports `components/logs/LogExplorer`.
- No remaining code imports the deleted `components/ObservabilityLogExplorer`.

- [ ] **Step 1: Audit stale references**

  Run `rg -n "ObservabilityLogExplorer|log-explorer__|observability-explorer" app components lib` and remove only references proven unused by the new module.

- [ ] **Step 2: Run static gates**

  ```bash
  pnpm exec tsc --noEmit --pretty false --incremental false
  node --check scripts/local-db-migrate.mjs
  git diff --check
  ```

- [ ] **Step 3: Run local authenticated runtime checks**

  With the local PostgreSQL and dev server running, verify login, `/admin/logs`, all scope tabs, SLS query validation, full-result facets, cursor paging, browser Back/Forward, row details, copy/retry, and no CSS/JS 404s. Do not run `pnpm build` concurrently with `pnpm dev`; if a production build is needed, stop dev first and restart it after the build.

- [ ] **Step 4: Review diff and working tree**

  Confirm no generated `.next` directory, credentials, unrelated files, or automatically generated test files are staged. Confirm all four category labels and “其他来源” are visible in the final UI.

- [ ] **Step 5: Commit integration cleanup**

  ```bash
  git add app/admin/logs/page.tsx app/globals.css components/logs lib/observability app/api/observability/logs
  git commit -m "refactor(observability): integrate log explorer workbench"
  ```

## Final Verification Checklist

- [ ] `pnpm exec tsc --noEmit --pretty false --incremental false` passes.
- [ ] `node --check scripts/local-db-migrate.mjs` passes.
- [ ] `git diff --check` passes.
- [ ] Local authenticated `/admin/logs` returns 200 and all referenced CSS/JS assets return 200.
- [ ] `scope=all` keeps browser/API/API runtime/infrastructure/other rows visible.
- [ ] `focus=app-first` reorders/groups without changing total.
- [ ] Facets and summary use full applied result counts.
- [ ] Cursor pagination and URL Back/Forward are stable.
- [ ] Every row opens a category-aware detail inspector with full redacted JSON, copy, and retry.
- [ ] No unrelated files or generated tests are included.
