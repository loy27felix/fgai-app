# Coding Conventions

**Analysis Date:** 2026-11-05

## Naming Patterns

**Files:**
- 本文以主站 `app/`、`components/`、`lib/`、`tests/` 和独立 `worker/` 为主；`production-lab/` 的 upstream/vendor 仅抽样确认边界，不代表统一规范。
- Next.js App Router 使用目录表达路由，入口为 `page.tsx`、`route.ts`，如 `app/production-lab/page.tsx`、`app/api/creator/worker/jobs/claim/route.ts`。
- Workspace 组件多为 PascalCase，如 `components/creator/CreatorWorkspace.tsx`；canvas 组件也有 kebab-case，如 `components/canvas/canvas-zoom-controls.tsx`，不宜全局强改命名。
- 业务 helper 多为 kebab-case，如 `lib/creator/media-worker-auth.ts`；同时保留 `lib/chatStore.ts`、`lib/creator/imageStorage.ts` 等 camelCase 历史文件。
- Hook/store 文件示例为 `hooks/use-copy-text.ts`、`stores/use-theme-store.ts`；Python package/module 使用 snake_case，如 `worker/src/fg_worker/queue_loop.py`。

**Functions:**
- React 组件用 PascalCase；Hook 使用 `use` 前缀，如 `CanvasZoomControls`、`useThemeStore`，见 `components/canvas/canvas-zoom-controls.tsx`、`stores/use-theme-store.ts`。
- TypeScript helper 使用 camelCase 和动作前缀，如 `authenticateWorker`、`claimNextMediaJob`，见 `app/api/creator/worker/jobs/claim/route.ts`。
- Route handler 按 HTTP 方法命名导出 `POST`；Python 使用 `run_once`、`_run_job` 等 snake_case，见 `worker/src/fg_worker/queue_loop.py`。

**Variables:**
- JS/TS 局部变量、参数使用 camelCase；常量使用 UPPER_SNAKE_CASE，如 `STARTER_PROMPTS`，见 `components/creator/CreatorWorkspace.tsx`。
- 持久化记录保留 snake_case 字段，如 `workspace_id`、`user_id`；HTTP job spec 使用 `sourceAssetId`、`idempotencyKey`，见 `tests/creator/image-api-contract.test.ts`、`types/media-worker.ts`。
- Python 常量也使用 UPPER_SNAKE_CASE，如 `HEARTBEAT_SECONDS`；跨语言协议不能直接随 Python 局部变量改名，见 `worker/src/fg_worker/queue_loop.py`。

**Types:**
- 业务类型、Props、Error class 使用 PascalCase；`type`、union、`interface` 按所在模块既有风格使用，见 `types/media-worker.ts`、`tests/creator/image-storage.test.ts`。
- 状态和操作名使用 string literal union，例如 `MediaJobStatus`、`MediaOperation`，见 `types/media-worker.ts`。
- Python 使用 `dict[str, Any]`、`str | None`、`Callable` 和 dataclass；最低 Python 3.11，见 `worker/src/fg_worker/client.py`、`worker/pyproject.toml`。

## Code Style

**Formatting:**
- 主站未发现根级 Prettier、Biome、EditorConfig 配置，也没有 `format` script；不能把 vendor formatter 当成主站规则，依据 `package.json` 与根目录配置清点。
- 既有 TS/TSX 普遍使用分号，但单双引号、2/4 空格混用；对比 `components/creator/CreatorWorkspace.tsx`、`components/canvas/canvas-zoom-controls.tsx`、`lib/observability/server-log.ts`，修改应保持文件局部风格。
- Python 样本使用 4 空格、类型注解与 `from __future__ import annotations`；`worker/pyproject.toml` 未定义 Ruff/Black 配置，不据此声称已启用格式门禁。
- 主站声明 pnpm 9.15.0、Next.js 14.2.15、TypeScript `^5.5.4`、React `^18.3.1`；这些是 manifest 声明，不是本轮运行时实测，见 `package.json`。
- `tsconfig.json`：`target: ES2020`、`strict: true`、`noEmit: true`、`isolatedModules: true`、`moduleResolution: bundler`、`jsx: preserve`。
- 同时开启 `allowJs`、`skipLibCheck`、`resolveJsonModule`、`incremental`；包含 `.next/types/**/*.ts`，排除 `node_modules`、`production-lab`，见 `tsconfig.json`。
- `strict` 不等于没有显式 `any`；`lib/chatStore.ts` 存在 legacy `any`，不要把观察结果写成全仓严格无 `any`。
- 工具边界：`production-lab/meilin/canvas/web/.prettierrc.json` 是该独立 Web 的 4 空格、双引号、分号、`printWidth: 255`，不适用于主站。

**Linting:**
- 根 `package.json` 定义 `lint: next lint`，但未发现根 ESLint 配置，且 manifest 未声明 `eslint` / `eslint-config-next`；命令存在不代表可非交互成功，本轮未执行。
- 不存在已确认的主站统一 import-sort、Hooks lint 或格式规则；`tsconfig.json` 的类型检查与 ESLint 是不同入口。
- `worker/pyproject.toml` 未声明 lint/typecheck/test optional dependency group；不能继承 ArcReel 的 Ruff、basedpyright 配置。
- ArcReel frontend 使用独立 ESLint/Vitest，Yingce Web 使用 Bun/ESLint/Prettier，OpenCreator 为 pnpm workspace；分别以 `production-lab/arcreel/upstream/frontend/package.json`、`production-lab/meilin/canvas/web/package.json`、`production-lab/opencreator/upstream/package.json` 为准。

## Import Organization

**Order:**
1. 客户端组件需要时以 `"use client"` 开头，再引入 React、Next.js 或第三方库；示例 `components/creator/CreatorWorkspace.tsx`。
2. 业务组件与 helper 使用 `@/` 项目别名；`import type` 在部分文件中单独书写，如 `components/canvas/canvas-zoom-controls.tsx`。实际顺序有混排，没有自动排序配置证据。
3. 根测试使用 `node:test`、`node:assert/strict` 和相对源码路径；Python 使用标准库后接相对包导入，见 `tests/production-lab-origin.test.ts`、`worker/src/fg_worker/queue_loop.py`。

**Path Aliases:**
- 根 `@/*` 映射 `./*`，不是 `src/*`；见 `tsconfig.json`。
- `production-lab` 虽被根 TypeScript 排除，主站适配层仍位于 `lib/production-lab/`、`components/production-lab/`、`app/api/production-lab/`，不能将这些目录一并排除。
- ArcReel Vitest 的 `@` 指向其自身 `src`；不能把这个解析规则套在根测试，见 `production-lab/arcreel/upstream/frontend/vitest.config.ts`。

## Error Handling

**Patterns:**
- API 先检查 feature gate / authentication，再执行业务；已知领域错误携带 `code`、`status` 并转为 JSON，未知异常返回稳定的中文错误，见 `app/api/creator/worker/jobs/claim/route.ts`。
- 领域 Error class 封装协议状态，如 `MediaWorkerAuthError`；避免向客户端直接暴露底层异常，见 `lib/creator/media-worker-auth.ts`。
- 客户端 fetch wrapper 检查 `response.ok`，处理非 JSON 响应并保留追踪编号；不是只等待 JSON parse，见 `components/creator/CreatorWorkspace.tsx` 的 `readCreatorResponse`。
- UI 错误可进入局部 `error` state，或使用 Ant Design `App.useApp().message`；见 `components/creator/CreatorWorkspace.tsx`、`hooks/use-copy-text.ts`。
- Python `WorkerApiError` 保留 `status`、`code`；queue loop 根据错误码或 `retryable` 上报失败，并在 `finally` 释放 heartbeat 线程，见 `worker/src/fg_worker/client.py`、`worker/src/fg_worker/queue_loop.py`。
- CLI 使用 stderr 与非零退出码表达失败；后台任务异常处理不等同于全局日志系统，见 `worker/src/fg_worker/__main__.py`。

## Logging

**Framework:** 主站自有 structured console wrapper；Python CLI 使用 `print` / stderr，见 `lib/observability/server-log.ts`、`worker/src/fg_worker/__main__.py`。

**Patterns:**
- `logServerEvent` 生成带 `event`、`timestamp`、`timestampUtc` 的 JSON，按 level 进入 `console.info/warn/error`，见 `lib/observability/server-log.ts`。
- `requestTraceId` 接受安全的 `x-fg-trace-id` / `x-request-id`，否则生成 UUID；`attachTraceId` 回写响应头，见 `lib/observability/server-log.ts`。
- 使用 `redactServerLogText`、`safeProviderHeaders`、`redactProviderUrl` 等边界处理凭据、签名 URL、二进制内容与体积限制；不要绕过 helper 输出原始 provider payload，见 `lib/observability/server-log.ts`。
- Node 日志持久化动态加载；Edge runtime 不加载数据库 writer，见 `lib/observability/server-log.ts`、`lib/observability/server-log-persistence.ts`。
- 客户端使用 `logClientEvent`，见 `components/creator/CreatorWorkspace.tsx`、`lib/observability/client-log.ts`；不存在已确认的全仓统一第三方 logger。

## Comments

**When to Comment:**
- 样本注释侧重安全、平台边界和非显然原因，如 Edge/Node 分离、Unicode surrogate 修复，见 `lib/observability/server-log.ts`。
- 新改动遵循任务约定使用中英文双语解释必要意图；现存文件既有双语也有 English-only 注释，不为统一语言改写无关内容，示例 `next.config.mjs`、`worker/src/fg_worker/queue_loop.py`。
- 不将源码注释中的能力声明当成运行证明；跨语言词汇约束以 `types/media-worker.ts` 与 Python 对应调用为共同依据。

**JSDoc/TSDoc:**
- 使用普通 `/** ... */` 说明共享协议与安全用途；例如 `types/media-worker.ts`、`lib/observability/server-log.ts` 的 `fullLogPayload`，未发现强制文档生成门禁。
- Next.js 配置通过 `@type {import('next').NextConfig}` 提供类型提示，见 `next.config.mjs`。

## Function Design

**Size:** 未发现可执行的函数长度限制；既有短 helper 与较大 Workspace 并存。优先保持职责与局部一致性，不将 `components/creator/CreatorWorkspace.tsx` 的体量推断成推荐尺寸。

**Parameters:**
- React 用 typed props；业务调用常用对象参数，factory 可注入 storage/client/service，见 `components/canvas/canvas-zoom-controls.tsx`、`lib/creator/image-item-route.ts`。
- Python 将 client、capabilities、runner 注入 `WorkerLoop`，减少媒体处理与轮询耦合，见 `worker/src/fg_worker/queue_loop.py`。
- 局部 UI 状态用 `useState/useRef/useEffect`；持久主题状态复用 Zustand `persist`，见 `components/creator/CreatorWorkspace.tsx`、`stores/use-theme-store.ts`。不应因依赖存在就要求所有状态进入全局 store。
- 新增 UI/日期交互优先复用已有 `antd`、`dayjs`；根依赖与约束见 `package.json`、`AGENTS.md`。主站 Tailwind 仍为 v3，不按 upstream 工具版本迁移。

**Return Values:**
- helper 返回明确 domain data 或 Promise；Route handler 返回 Response/NextResponse；Python poll 使用 bool 表示本轮是否领到工作，见 `lib/chatStore.ts`、`app/api/creator/worker/jobs/claim/route.ts`、`worker/src/fg_worker/queue_loop.py`。
- 保留早返回与稳定协议；以下是 `app/api/creator/worker/jobs/claim/route.ts` 的既有错误映射片段：
```typescript
if (error instanceof MediaWorkerAuthError || error instanceof MediaWorkerQueueError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
```

## Module Design

**Exports:**
- Route handlers 使用 named exports（`POST`、`runtime`）；组件既有 default export（`CreatorWorkspace`）也有 named export（`CanvasZoomControls`），遵循邻近文件，见对应 `components/` 文件和 `app/api/creator/worker/jobs/claim/route.ts`。
- helper / contract 通常直接 named export；不要为本次映射创造统一 facade，见 `types/media-worker.ts`、`lib/creator/media-worker-auth.ts`。
- 保持 browser/server 边界：数据库、Worker authentication 留在服务端；UI 通过 API 调用，不把 provider credential 或本机路径加入共享类型，见 `types/media-worker.ts`、`lib/observability/server-log.ts`。
- `next.config.mjs` 的本地 `/fg-six` rewrite 是适配入口；独立 upstream 的 package scripts 和 runtime 不因同仓储存而归根 Next.js 管理。

**Barrel Files:**
- 在本轮 `lib/`、`components/`、`hooks/`、`stores/` 三层深度清点中未发现 `index.ts(x)` barrel；样本使用直接文件导入，不应推广成对整个 vendor 树的断言。
- Python operation package 存在 `worker/src/fg_worker/operations/__init__.py`；执行入口与注册逻辑分别在 `worker/src/fg_worker/__main__.py`、`worker/src/fg_worker/operations/registry.py`，不套用 TS barrel 约定。

---

*Convention analysis: 2026-11-05*
