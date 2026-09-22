# 画布重命名云同步修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让入口页和详情页的画布名称通过同一云端 PATCH 协议持久化，刷新后不回滚、不生成恢复副本。

**Architecture:** 在 `canvas-client` 增加只负责解析版本并更新标题的 API helper；入口卡片和详情页调用该 helper，成功后写回本地标题、云端版本和同步签名。刷新同步仍以云端版本为权威，但正常成功的标题变更不会进入本地冲突分支。

**Tech Stack:** React、Zustand、Next.js API Route、现有 `creator_canvases` PATCH 接口。

**Spec:** `docs/superpowers/specs/2026-09-22-canvas-log-audit-fixes-design.md`

## Global Constraints

- 不新增数据库迁移或第三方依赖。
- 不改变节点、连接、删除、导入、复制的既有语义。
- 云端失败不得静默回滚用户输入；入口页需要显示失败信息。
- 不新增自动化测试代码，使用现有测试、TypeScript、构建和可重复浏览器链路验证。

---

### Task 1: 提供共享标题更新 helper

**Files:**
- Modify: `lib/creator/canvas-client.ts`

**Interfaces:**
- Produces `renameCreatorCanvas(id: string, title: string, expectedVersion?: number | null): Promise<CreatorCanvasResponse>`。
- Missing version is resolved with `getCreatorCanvas`; supplied version is used unchanged for optimistic concurrency.

- [ ] **Step 1: Define the helper contract**

  Keep title trimming/validation in the API route; the client helper only resolves a missing version and calls the existing `updateCreatorCanvas` with `{ title, expectedVersion }`.

- [ ] **Step 2: Run TypeScript before dependent changes**

  Run: `pnpm exec tsc --noEmit --pretty false --incremental false`

- [ ] **Step 3: Commit the isolated client helper**

  ```bash
  git add lib/creator/canvas-client.ts
  git commit -m "feat(canvas): add shared cloud rename helper"
  ```

### Task 2: Persist entry-card renames and surface failures

**Files:**
- Modify: `reference/infinite-canvas/src/components/canvas/canvas-project-card.tsx`
- Modify: `reference/infinite-canvas/src/stores/canvas/use-canvas-store.ts` only if a type-safe metadata patch is required

**Interfaces:**
- Entry card saves local-only projects locally.
- Cloud-backed projects call `renameCreatorCanvas`, then update title/version/signature only after the response succeeds.

- [ ] **Step 1: Make the save handler async**

  For a cloud-backed project, call the helper with `project.cloudCanvasId` and `project.cloudCanvasVersion`; for a local-only project, preserve current local rename behavior.

- [ ] **Step 2: Update sync metadata after success**

  Build the signature from the project with the new title and call `updateProject` with the new title, returned version, and `cloudLocalSignature`. Keep the new title on failure and show an Ant Design error message so the user can retry.

- [ ] **Step 3: Verify the entry-card path**

  Run `pnpm exec tsc --noEmit --pretty false --incremental false` and inspect the diff to ensure no unrelated card actions changed.

### Task 3: Make detail-page renames use the same protocol

**Files:**
- Modify: `reference/infinite-canvas/src/pages/canvas/project.tsx`

**Interfaces:**
- `finishTitleEditing` awaits the shared helper when `currentProject.cloudCanvasId` exists.
- Local state remains editable on failure and displays an actionable message.

- [ ] **Step 1: Replace local-only finish logic**

  Rename locally only for projects without a cloud ID. For cloud projects, call the helper, update title/version/signature after success, and keep the draft on failure.

- [ ] **Step 2: Keep graph sync compatible**

  Do not remove the existing graph sync effect; its next run may persist graph changes, while the title-only action prevents a refresh-before-900ms loss.

- [ ] **Step 3: Verify detail-page compilation**

  Run `pnpm exec tsc --noEmit --pretty false --incremental false`.

### Task 4: Validate refresh conflict behavior

**Files:**
- Modify: `reference/infinite-canvas/src/pages/canvas/index.tsx` only if the successful-title metadata still enters the recovery branch after Tasks 1–3.

- [ ] **Step 1: Inspect the existing signature/refresh branch**

  Confirm `cloudLocalSignature` is updated with the returned title and version before refresh; do not weaken graph conflict detection for unconfirmed local edits.

- [ ] **Step 2: Run focused static gates**

  ```bash
  pnpm exec tsc --noEmit --pretty false --incremental false
  git diff --check
  ```

- [ ] **Step 3: Verify the user flow**

  In an authenticated local browser: rename “超级画布 1” to “超级画布 999”, wait for success, refresh `/creator#/canvas`, and confirm one card remains with the new name. If runtime auth is unavailable, report that boundary instead of claiming the flow passed.

