# Fielded Log Search Implementation Plan

> **For agentic workers:** Execute tasks in order. This plan follows the repository rule that no new automated test files are generated unless explicitly requested.

**Goal:** Deliver a log workbench that supports equivalent visual filters and constrained SLS-style query input.

**Architecture:** Normalize visual URL parameters and SLS tokens into the existing log query contract, preserve the unified event CTE, and expose matching controls in the existing Ant Design workbench. Add only high-value SQL indexes for structured, time-bound filters.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL, Ant Design.

**Spec:** `docs/superpowers/specs/2026-09-21-fielded-log-search-design.md`

## Global Constraints

- Keep old `q/source/level/time/cursor/offset/limit` behavior compatible.
- Do not add dependencies, test files, generic JSON indexes, or interactive lint configuration.
- Every SQL value must be parameterized. Known SLS fields with invalid syntax, comparison, numeric values, or conflicting ranges must produce a 400 response; unknown `field:value` remains one legacy full-text word, while unknown `=`, `>=`, `<=` comparisons return 400.

### Task 1: Normalize and execute structured log filters

**Files:**
- Modify: `app/api/observability/logs/route.ts`
- Modify: `lib/observability/log-query.ts`

- [x] Parse text filters and HTTP status/duration exact or range parameters from the request.
- [x] Parse constrained SLS `q` tokens and merge them with visual parameters. Reject invalid known-field syntax, comparisons, numeric values, and conflicting ranges with 400 JSON; retain unknown `field:value` as one legacy full-text word, but reject unknown `=`, `>=`, `<=` comparisons.
- [x] Apply normalized conditions consistently to the existing unified CTE using SQL placeholders; retain bare-word full-text matching and cursor pagination.
- [x] Verify with `pnpm exec tsc --noEmit --pretty false --incremental false`, known SLS and legacy unknown `field:value` examples, malformed known-field quote/comparison/numeric/range examples, unknown comparison examples, and `git diff --check`.

### Task 2: Add targeted query indexes

**Files:**
- Create: `docker/initdb/015-observability-log-query-indexes.sql`
- Modify: `scripts/local-db-migrate.mjs`

- [x] Inspect existing schema and index coverage before adding indexes.
- [x] Add `occurred_at`-oriented indexes for request, trace, task, service/event, route and HTTP status where those physical columns exist.
- [x] Register the migration using the existing ordered migration manifest.
- [x] Verify JavaScript syntax with `node --check scripts/local-db-migrate.mjs`, inspect migration transaction boundaries, and run `git diff --check`.

### Task 3: Build equivalent visual and SLS search interactions

**Files:**
- Modify: `components/ObservabilityLogExplorer.tsx`
- Modify: `app/admin/logs/page.tsx`

- [x] Add an explicit SLS query field with concise examples and retain it as `q`.
- [x] Add visual controls for every supported structured field and status/duration bounds; serialize them to the same URL/API parameter names.
- [x] Show active conditions as removable Chips, preserve them on refresh/direct links, and clear pagination when a condition changes.
- [x] Surface route, HTTP status and duration in rows; make trace/request/task/user/route/status/event/outcome values refill the corresponding filter.
- [x] Make existing time buckets drill into their time window when the API provides them, while retaining the inspector and JSON detail.
- [x] Verify with `pnpm exec tsc --noEmit --pretty false --incremental false` and `git diff --check`; do not run unconfigured interactive `next lint`.

### Task 4: Integrate and review

**Files:**
- Review: all files above

- [x] Reconcile the API parameter names used by the UI with the API parser, especially `httpStatusGte/httpStatusLte` and `durationMsGte/durationMsLte`.
- [x] Run combined TypeScript, migration-manifest, whitespace, and query-parser checks.
- [x] Perform an independent read-only code review; resolve Critical and Important findings before committing.
