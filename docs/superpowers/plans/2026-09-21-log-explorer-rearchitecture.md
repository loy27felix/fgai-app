# 日志检索工作台重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/admin/logs` 重构为支持 SLS 查询、四类日志分类、全量 Facet、稳定 cursor 分页和逐条详情检查的高密度日志工作台。

**Architecture:** 后端继续使用四条持久化事件流的统一 SQL CTE，但在查询层一次性归一化 `category`、Facet、时间线和列表摘要。前端以 URL 表示唯一 applied query，React 只维护草稿、请求生命周期、结果快照和选中日志，并拆分查询栏、时间线、Facet、日志流和详情检查器。

**Tech Stack:** Next.js 14 App Router、React、TypeScript、PostgreSQL、Ant Design DatePicker、现有全局 CSS token。

**Spec:** `docs/superpowers/specs/2026-09-21-log-explorer-rearchitecture-design.md`

## Global Constraints

- 默认 `scope=all`，四个主类别和 `other` 扩展类别都可见；`focus=app-first` 只改变排序/分组，不过滤日志。
- 类别 key 固定为 `browser`、`api`、`api_runtime`、`infrastructure`、`other`；界面将 `api` 标为“HTTP 日志”、`api_runtime` 标为“API 日志”。服务端 app/provider 日志、审计及自定义标准排查事件进入 `api_runtime`；billing 导入事件按当前实际 source=app 归入 API，未找到生产者的 data source 不因枚举存在而扩大分类。
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

  Add a `category` expression to the shared `logs` CTE. Keep explicit `infra`/`deploy` and NAS/tunnel/nginx classification first; then classify exact `http_request_received`/`http_exchange_completed` events as `api` (visible “HTTP 日志”); classify other `frontend` events as `browser`; classify non-HTTP `app`/`provider` events and audit rows as `api_runtime` (visible “API 日志”); preserve unknown sources as `other`. Never infer an HTTP exchange only from `route`, `http_status`, or `service`. Use the same expression for list, summary, timeline, facets, and detail lookup.

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

  With a logged-in local browser session, verify `scope=all`, each category scope, `category:api status>=500` for HTTP records, `category:api_runtime` for API internal records, an invalid category 400, first-page `nextCursor`, next-page stability, and one detail request for each persisted ID prefix.

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

  HTTP rows show method/route/status/duration and trace/request IDs; API rows show service/event/message/outcome, audit actor/action/resource, and safe custom context; browser rows show page/agent/user context; infrastructure rows show component/host/event/message; other rows show true source/service/event without relabelling.

- [ ] **Step 2: Implement dense stream rows**

  Use one shared grid definition for header and rows. Keep time and level narrow, service/event and route/status as primary blocks, correlation IDs as mono secondary text, and summary as the widest column. Selecting any row opens the inspector without navigating away.

- [ ] **Step 3: Implement detail loading**

  On selection, call `/api/observability/logs/${encodeURIComponent(row.id)}`. Show loading, local error with retry, and a stable empty state. A detail failure must not alter `snapshot.rows` or pagination.

- [ ] **Step 4: Implement full detail inspector**

  Render common fields, category-specific fields, correlation IDs, HTTP exchange request/response when present, `ingestedAt` if available, and full redacted JSON in a scrollable code block. Add copy controls for IDs and JSON with visible success/error feedback.

- [ ] **Step 5: Verify every category**

  Using local sample data, open one browser, HTTP, API, infrastructure, and other row. Confirm all show detail fields, JSON, copy actions, close/reopen behavior, and detail retry without losing the result list.

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
- [ ] `scope=all` keeps browser/HTTP/API/infrastructure/other rows visible.
- [ ] `focus=app-first` reorders/groups without changing total.
- [ ] Facets and summary use full applied result counts.
- [ ] Cursor pagination and URL Back/Forward are stable.
- [ ] Every row opens a category-aware detail inspector with full redacted JSON, copy, and retry.
- [ ] No unrelated files or generated tests are included.

---

## Follow-up: 2026-09-23 Align HTTP/API taxonomy and custom event context

**Goal:** Make the visible “HTTP 日志” category contain only explicit request/response exchange records, and make “API 日志” contain server-side API custom logs/messages, diagnostic standard events, and audit events.

**Architecture:** Preserve the existing serialized category keys (`api` remains the HTTP bucket and `api_runtime` remains the API-internal bucket) so saved `scope` URLs keep their meaning. Correct the shared SQL classification, then use the existing redacted payload to provide bounded scalar previews in list rows and generic, width-aware context fields in the inspector. Do not add a database migration or a new log producer.

**Global constraints:** Keep the existing URL/category keys; keep `audit_events` deduplication by `event_id`; do not classify by `route`/`http_status` alone; do not return full payloads in list rows; do not generate test code; make one scoped local commit per implementation task; do not push or deploy.

**Review Focus:** A frontend `http_exchange_completed` remains HTTP despite `source=frontend`; an unrelated frontend error on `/api/*` remains a browser event; a server error with route/status remains an API event; audit rows mirrored to the log stream remain deduplicated; nested or sensitive custom context is not exposed in list previews and stays bounded/readable in details.

### Task 8: Correct server event taxonomy and expose bounded list context

**Files:**
- Modify: `lib/observability/log-query.ts`
- Modify: `lib/observability/log-search-contract.ts`
- Modify: `docs/superpowers/specs/2026-09-21-log-explorer-rearchitecture-design.md`
- Modify: `docs/superpowers/plans/2026-09-21-log-explorer-rearchitecture.md`

**Interfaces:**
- Keep `LogCategory` values `api` and `api_runtime`; their visible labels are “HTTP 日志” and “API 日志”.
- Add `contextPreview: Array<{ key: string; value: string }>` to list `LogRecord`; each preview contains at most four redacted scalar fields with values truncated to 120 characters. Full objects/arrays remain exclusive to detail responses.

- [ ] **Step 1: Correct each LOG_CTE stream by event meaning**

  Set the `audit_events` CTE category to `api_runtime`, retaining `kind='audit'`, source, and the existing event-id de-duplication against mirrored `observability_log_events`.

  For `observability_log_events`, classify exact exchange events before source rules:

  ```sql
  when log.source in ('infra', 'deploy') then 'infrastructure'
  when lower(coalesce(log.service, '') || ' ' || coalesce(log.event_name, '')) ~ '(nas|tunnel|nginx)' then 'infrastructure'
  when log.event_name in ('http_request_received', 'http_exchange_completed') then 'api'
  when log.source = 'frontend' then 'browser'
  when log.source in ('app', 'provider', 'audit') then 'api_runtime'
  else 'other'
  ```

  For `observability_error_events`, route `frontend` errors to `browser`; route `app` and `provider` errors to `api_runtime`; keep `infra`/`deploy` and infrastructure service errors in `infrastructure`. Do not classify an error as HTTP only because it has `route` or `http_status`. Keep service-health events in `infrastructure` and do not alter exchange duplicate suppression.

- [ ] **Step 2: Add bounded scalar context preview during normalization**

  Use `normalizeRecord`'s already deserialized/redacted `details`. Select at most four scalar key/value pairs, preferring diagnostic context such as `stage`, `reason`, `path`, `bucket`, `size`, and `hasRange`, then preserving payload order. For audit records, prioritize `stage`, `action`, `resourceType`, and `resourceId` so the row can identify the audited target. Exclude sensitive-key matches and standard fields already shown as message, event, service, IDs, route, or status. Truncate rendered values to 120 characters. Never copy nested objects or arrays into the list response.

- [ ] **Step 3: Run the existing test suite and type check**

  ```bash
  pnpm test
  pnpm exec tsc --noEmit --pretty false --incremental false
  git diff --check
  ```

- [ ] **Step 4: Commit only Task 8 files**

  ```bash
  git add lib/observability/log-query.ts lib/observability/log-search-contract.ts docs/superpowers/specs/2026-09-21-log-explorer-rearchitecture-design.md docs/superpowers/plans/2026-09-21-log-explorer-rearchitecture.md
  git commit -m "fix(observability): classify HTTP and API logs"
  ```

### Task 9: Align category copy, rows, and inspector context rendering

**Files:**
- Modify: `components/logs/log-detail-formatters.ts`
- Modify: `components/logs/LogFacets.tsx`
- Modify: `components/logs/LogQueryBar.tsx`
- Modify: `components/logs/LogExplorer.tsx`
- Modify: `components/logs/LogStream.tsx`
- Modify: `components/logs/LogInspector.tsx`
- Modify: `app/globals.css` only for the custom context value layout

**Interfaces:**
- Consume the `LogRecord.contextPreview` added in Task 8.
- Keep one central category-label mapping: `api` → “HTTP 日志”; `api_runtime` → “API 日志”.

- [ ] **Step 1: Update all user-visible category labels and SLS help**

  Replace “API 请求日志” with “HTTP 日志” and “业务运行日志” with “API 日志” in tabs, facets, total breakdown, row/inspector badges, and search help. Keep the underlying query keys and explain in the field list that `category:api` is the legacy HTTP bucket while `category:api_runtime` is API-internal logs.

- [ ] **Step 2: Render category-specific row summaries**

  HTTP rows prioritize method, route, status, duration, and request/trace identifiers. API rows prioritize the event name and message; show audit actor/action/resource when `kind === 'audit'`, and use `contextPreview` for custom scalar fields. Avoid repeating message in both status and summary cells.

- [ ] **Step 3: Expose custom context and keep complex values readable**

  Build inspector context from existing known fields plus remaining custom payload keys without duplicating request/response/error/raw JSON sections. Scalar values use the existing label/value layout. Arrays and objects occupy a full-width row, remain collapsible, and have bounded scrolling; label this section “事件上下文”. For audit records, show actor, feature/action, resource type/id, stage, and outcome.

- [ ] **Step 4: Verify the UI and production build**

  ```bash
  pnpm exec tsc --noEmit --pretty false --incremental false
  pnpm build
  git diff --check
  ```

  Confirm category labels are consistent across tabs/facets/summary/details; a frontend `http_exchange_completed` appears under HTTP logs despite `source=frontend`; a frontend error on `/api/*` stays under browser logs; a server error with route/status appears under API logs; mirrored audit events remain one API row; nested context JSON uses a full-width collapsible row and sensitive fields are not exposed in list previews. Do not run `pnpm build` concurrently with `pnpm dev`.

- [ ] **Step 5: Commit only Task 9 files**

  ```bash
  git add components/logs/log-detail-formatters.ts components/logs/LogFacets.tsx components/logs/LogQueryBar.tsx components/logs/LogExplorer.tsx components/logs/LogStream.tsx components/logs/LogInspector.tsx app/globals.css
  git commit -m "fix(logs): clarify HTTP and API log details"
  ```
