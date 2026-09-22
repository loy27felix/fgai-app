# 日志工作台审计修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复日志详情数据误读、错误堆栈丢失、响应式覆盖、浅色可读性和详情浮层语义问题。

**Architecture:** 保留现有四类日志和 SLS 查询模型，只修复规范化 formatter、服务端错误序列化、Provider 采集状态和已存在的 `.log-desk` 局部 token。详情面板继续由 `LogInspector` 控制，不引入新 UI 依赖。

**Tech Stack:** React、TypeScript、Next.js server logging、现有 CSS token、Ant Design。

**Spec:** `docs/superpowers/specs/2026-09-22-canvas-log-audit-fixes-design.md`

## Global Constraints

- 不改变日志分类、查询 URL 和 API 返回协议。
- 不把完整 payload 放回列表；请求、响应、Headers、Body 继续分区展示。
- 不新增自动化测试代码，使用既有测试、TypeScript、build、diff 检查和静态审计。
- 不使用 `defaultOpen` 等当前 React 类型不支持的属性；详情折叠状态使用受控 state。

---

### Task 1: 修复日志详情规范化和采集状态

**Files:**
- Modify: `components/logs/log-detail-formatters.ts`
- Modify: `lib/ai/wetoken-client.ts`
- Modify: `lib/observability/server-log.ts`

- [ ] **Step 1: Preserve null capture semantics**

  Separate “property exists” from “value is non-empty”; pass explicit `null` Body through to `body()` so captured empty Body renders as `empty`, while absent Body remains unrecorded.

- [ ] **Step 2: Map top-level error-event fields**

  When `details.error` is absent, map top-level `code`, `message`, `name`, `status`, `stack`, `providerCode`, `retryable`, and `cause` into the structured error section. Add service-event context fields that are already persisted and safe to display.

- [ ] **Step 3: Make response evidence strict**

  Do not create a response section from status alone. Require nested response or response headers/body/encoding/bytes/truncated evidence; retain status as common context when no response payload exists.

- [ ] **Step 4: Represent Provider body read failures honestly**

  Keep `responseBodyReadFailed` in the event and set a non-JSON unavailable encoding/state instead of presenting `{}` as captured JSON. Preserve status and headers.

- [ ] **Step 5: Preserve server Error.stack**

  Add redacted stack serialization to `serialiseLogError` with the existing depth/budget constraints.

- [ ] **Step 6: Run focused static gates**

  ```bash
  pnpm exec tsc --noEmit --pretty false --incremental false
  git diff --check
  ```

### Task 2: Fix inspector layout, contrast and draft visibility

**Files:**
- Modify: `app/globals.css`
- Modify: `components/logs/LogQueryBar.tsx`
- Modify: `components/logs/LogExplorer.tsx`

- [ ] **Step 1: Align fixed inspector with query context**

  At 761–1560px, use `var(--log-context-top)` for the fixed inspector top offset and keep the collapsed value lower. Ensure the inspector does not cover the expanded query bar.

- [ ] **Step 2: Replace low-contrast legacy tokens**

  Override remaining `--log-muted` uses inside `.log-desk` with the readable log token; strengthen light-theme error and secondary text without changing the dark FG Studio direction.

- [ ] **Step 3: Show pending draft state in collapsed query**

  When `hasDraftChanges` is true, show “有待运行条件” in the collapsed summary and keep the applied query values distinguishable.

- [ ] **Step 4: Verify responsive CSS statically**

  Run `git diff --check` and inspect the media rules for the 760/761/1120/1560 boundaries.

### Task 3: Make fixed details semantically operable

**Files:**
- Modify: `components/logs/LogInspector.tsx`
- Modify: `app/globals.css` only if the backdrop/focus-visible styling requires it

- [ ] **Step 1: Add dialog semantics only in fixed mode**

  Keep the desktop inspector as an `aside`; expose `role="dialog"`, `aria-modal="true"`, and the existing labelled heading when the component is rendered as a fixed overlay. Avoid false modal semantics for the desktop three-column layout.

- [ ] **Step 2: Add focus restoration and Escape handling**

  Capture the previously focused element when a row opens, focus the close button when the overlay mounts, and restore focus after close. Keep Escape idempotent.

- [ ] **Step 3: Keep the component type-safe**

  Use controlled `<details open={...}>`; do not add unsupported DOM attributes. Run TypeScript immediately after editing.

### Task 4: Re-run the complete audit

**Files:**
- No production files; review all changed files and the design acceptance criteria.

- [ ] **Step 1: Run full verification**

  ```bash
  pnpm test
  pnpm exec tsc --noEmit --pretty false --incremental false
  pnpm build
  git diff --check
  ```

- [ ] **Step 2: Inspect every acceptance criterion**

  Verify structured error fields, unavailable/empty Body states, response evidence, stack retention, fixed inspector offset, light-theme tokens, collapsed draft warning, and modal focus semantics from source and command output.

- [ ] **Step 3: Report runtime boundary honestly**

  If a logged-in browser is available, inspect `/admin/logs` at expanded/collapsed query states and 761–1560px widths. Otherwise report static/build evidence separately from runtime evidence.

