# Architecture

**Analysis Date:** 2026-11-05

## Pattern Overview

**Overall:** Next.js App Router 模块化主站，加上由独立 gateway 聚合的影视生产子服务；不是一个共享数据库、共享进程的单体。主站入口见 `app/layout.tsx`、`middleware.ts`；子服务组合见 `production-lab/meilin/compose.yml`、`production-lab/meilin/gateway/server.mjs`。

**Key Characteristics:**
- 主站按 `app/` 页面 / Route Handler / Server Action → `lib/` 领域模块 → PostgreSQL / NAS 分层，但部分 API 直接编排查询；没有统一独立的后端服务层。证据：`app/projects/actions.ts`、`app/api/creator/canvases/route.ts`、`lib/local/db.ts`。
- `/creator` 实际嵌入 `reference/infinite-canvas/src/` 的 React 页面，以 MemoryRouter 与 URL hash 同步；该目录是参与主站运行的源码，不是仅供阅读的参考。证据：`app/creator/page.tsx`、`components/creator/InfiniteCanvasReferenceHost.tsx`。
- 名称相近的三个工作区必须区分：主站 Creator、Next 内旧 Production Lab、独立 Yingce 工作台；边界分别见 `app/creator/page.tsx`、`app/production-lab/page.tsx`、`production-lab/meilin/gateway/server.mjs`。
- 对外路径不只由 Next 决定：Nginx 将 `/fg-six/`、工具路径及 `/production-lab` 分流至 gateway；开发专用 rewrite 是另一种组合。证据：`docker/nginx/default.conf`、`next.config.mjs`。
- 本地图仅依据源码与声明配置，不据 README 的“已部署”字样推断在线状态、镜像版本、真实挂载或服务可用性。运行边界依据 `docker-compose.yml`、`production-lab/meilin/compose.yml`；保护约束依据 `AGENTS.md`。

## Layers

**主站页面与交互层：**
- Purpose: 提供登录、工作区、项目制作、对话、Creator 和管理入口。
- Location: `app/`、`components/`、`reference/infinite-canvas/src/`。
- Contains: Server Component 页面、Client Component、内嵌画布路由与浏览器状态；入口例见 `app/workspace/page.tsx`、`app/chat/page.tsx`。
- Depends on: `lib/local/server.ts` 读取服务端身份；客户端调用 `lib/creator/canvas-client.ts`、`lib/creator/image-client.ts` 等业务客户端。
- Used by: 浏览器访问；全局版本门禁与错误采集由 `app/layout.tsx` 挂载。

**主站 HTTP / Action 编排层：**
- Purpose: 处理身份、参数、资源归属、状态码及领域调用。
- Location: `app/api/`、`app/projects/actions.ts`、`app/admin/actions.ts`。
- Contains: `route.ts` HTTP handlers 与 `"use server"` Actions；Creator 示例为 `app/api/creator/images/[id]/confirm/route.ts`。
- Depends on: `lib/creator/`、`lib/ai/`、`lib/usage/`、`lib/local/`；调用关系见 `lib/creator/image-confirm-route.ts`。
- Used by: 页面与浏览器业务客户端；Worker 使用独立 bearer 接口，不使用网页登录会话，见 `lib/creator/media-worker-auth.ts`。

**主站领域与模型层：**
- Purpose: 管理生成任务、参考素材、画布图、制作流程、用量预算与服务商协议。
- Location: `lib/creator/`、`lib/canvas/`、`lib/ai/`、`lib/usage/`。
- Contains: 草稿确认状态机、视频状态恢复、图数据归一化、模型目录和费用账本；例见 `lib/creator/image-service.ts`、`lib/creator/video-recovery.ts`、`lib/creator/canvas-graph.ts`。
- Depends on: PostgreSQL / NAS 适配层、服务端 WeToken transport；证据：`lib/ai/wetoken-transport.ts`、`lib/usage/ledger.ts`。
- Used by: Creator API、通用 AI API 和旧 Lab 媒体任务；证据：`app/api/ai/chat/route.ts`、`lib/production-lab/media-runner.ts`。

**主站身份与持久化层：**
- Purpose: 保存账号、项目、创作数据与费用元数据，管理 NAS 文件与签名访问。
- Location: `lib/local/`、`docker/initdb/`。
- Contains: `pg.Pool`、参数化 `LocalQuery`、事务、session、storage adapter；入口见 `lib/local/db.ts`、`lib/local/auth.ts`、`lib/local/storage.ts`。
- Depends on: `DATABASE_URL`、NAS 挂载与 ready / disabled 守卫；声明见 `docker-compose.yml`、`docker-compose.nas.yml`。
- Used by: `lib/local/server-client.ts` 的近似 Supabase 风格接口；这是本地实现，不能按旧接口命名推断使用 Supabase 服务。
- 权限边界在调用方而不是 `LocalQuery` 自动行级隔离；浏览器通用查询端点只开放特定表并附加用户过滤，见 `app/api/local/db/route.ts`。

**异步执行与设备 Worker 层：**
- Purpose: 执行本地媒体处理和支持机器人任务；与服务商视频异步任务分开管理。
- Location: `lib/creator/media-worker-queue.ts`、`worker/src/fg_worker/`、`lib/support-bot/`。
- Contains: PostgreSQL 租约队列、配对认证、分块上传；Python 操作分发见 `worker/src/fg_worker/operations/registry.py`。
- Depends on: 主站 Worker API、可用处理能力与本机运行依赖；证据：`worker/src/fg_worker/client.py`、`worker/src/fg_worker/capabilities.py`。
- Used by: `app/api/creator/media/jobs/route.ts`；机器人由 `scripts/support-bot-worker.ts` 调用 `lib/support-bot/worker.ts`。

**Next 内旧 Production Lab 层：**
- Purpose: 选题、项目、剧本、项目画布、素材与试用媒体生产；不等于 `/fg-six/` 原生后端。
- Location: `components/production-lab/`、`app/api/production-lab/`、`lib/production-lab/`。
- Contains: 命令式领域状态、revision 控制、script runs、canvas 与媒体任务；见 `lib/production-lab/domain.ts`、`lib/production-lab/store.ts`。
- Depends on: 独立 `PRODUCTION_LAB_DATABASE_URL`，禁止与主站 DB 指向相同 host / port / database；素材复用 NAS adapter。证据：`lib/production-lab/store.ts`、`lib/production-lab/media-store.ts`。
- Used by: `app/production-lab/page.tsx`；但 Nginx 配置会将同名页面入口代理给独立 gateway，见 `docker/nginx/default.conf`。

**独立生产工作台集成层：**
- Purpose: 将 FG 登录身份映射到原生工作台，提供费用、模型、协作与工具服务边界。
- Location: `production-lab/meilin/gateway/`；组合入口为 `production-lab/meilin/compose.yml`。
- Contains: Node HTTP gateway、`fg-*.mjs` 适配器、扩展表、实时连接、内部服务路由；见 `production-lab/meilin/gateway/server.mjs`、`production-lab/meilin/gateway/fg-schema.sql`。
- Depends on: 主站 `/api/auth/session`、独立工作台 PostgreSQL、原生 web / backend 以及所接子服务。
- Used by: `/fg-six/` 公共入口及工具路由；网关把可信身份换为原生 session，再代理原生服务，见 `production-lab/meilin/gateway/policy.mjs`。
- 维护边界：FG 集中适配在 gateway 与各 `deploy/`，原生应用在 `canvas/` 或 `upstream/`；这些原生树也含 FG 改造，不能把整个目录当成可直接覆盖的 vendor。证据：`production-lab/adcraft/upstream/apps/api/fg_main.py`、`production-lab/meilin/upstream/server/fg-server.mjs`。

**独立子应用运行与存储边界：**
- Yingce：前端 `production-lab/meilin/canvas/web/src/application.tsx` → Go `production-lab/meilin/canvas/backend/cmd/server/main.go`；组合声明 PostgreSQL、Redis、migrate、`yingce-agent`、backend、web。业务元数据在工作台 DB，NAS 映射给 backend；证据：`production-lab/meilin/compose.yml`。
- Yingce Agent：独立 Node 服务入口 `production-lab/meilin/canvas/yingce-agent/server.mjs`；后端通过 `YINGCE_AGENT_URL` 调用，不能误记为主站 Python Worker。证据：`production-lab/meilin/compose.yml`。
- AdCraft：React web + `uvicorn fg_main:app` + Pi Agent；入口为 `production-lab/adcraft/upstream/apps/web/src/main.tsx`、`production-lab/adcraft/upstream/apps/api/fg_main.py`、`production-lab/adcraft/upstream/apps/api/agent/src/server.ts`。每 workspace 私有 SQLite 位于持久卷，媒体和一致性备份位于 NAS，见 `production-lab/adcraft/upstream/apps/api/app/fg_backup.py`。
- Meilin：FG 模式入口 `production-lab/meilin/upstream/server/fg-server.mjs`，不是 standalone `server/index.mjs`；使用 PostgreSQL 剧目文档 / revision / 成员数据、NAS uploads，模型制作经 gateway bridge；见 `production-lab/meilin/upstream/server/fg-store.mjs`、`production-lab/meilin/upstream/server/fg-context.mjs`、`production-lab/meilin/deploy/Dockerfile`。
- Suno：独立 `production-lab/suno/server.ts`，经 `current-api.mjs` 调用音乐服务；私有账号配置仅供运行时读取，operation JSON 与 MP3 在 state 目录，见 `production-lab/suno/contract.mjs`、`production-lab/suno/compose.yml`。是否实际启用不由源码存在证明。
- OpenCreator：保留 Web / Daemon / Desktop 源码与每用户 runtime 适配；`production-lab/opencreator/deploy/entry.mjs` 启动 Daemon，私有 `/state` 与 `/workspace` 分离。ArcReel：保留 FastAPI / Agent / 核心库及 SQLite state + NAS workspace 适配，入口见 `production-lab/arcreel/deploy/entry.py`、`production-lab/arcreel/deploy/Dockerfile`。
- 上述“保留”不等于当前开放：gateway 对 Creator Web、ArcReel / Director 等路径明确返回 410；ArcReel provision 也有退役保护。以 `production-lab/meilin/gateway/fg-retired-modules.mjs`、`production-lab/meilin/gateway/server.mjs`、`production-lab/arcreel/deploy/provision.py` 为准，不依据旧 README 恢复服务。

## Data Flow

**登录、项目与浏览器数据：**
1. `middleware.ts` 生成 trace 并调用 `lib/local/middleware.ts`；其 session cookie 存在性检查不是完整身份认证。
2. `app/api/auth/signin/route.ts` → `lib/local/auth.ts` 校验账号并写 `sessions`，设置 `fg_session`；页面 / API 再通过 `getCurrentUser()` 验证真实会话。
3. `app/projects/page.tsx`、`app/projects/actions.ts` 读取 / 修改项目与成员；分集、剧本等入口在 `app/projects/[id]/script/page.tsx`、`app/projects/[id]/script/actions.ts`。
4. 浏览器兼容数据客户端 `lib/local/client.ts` → `app/api/local/db/route.ts` → `LocalQuery`；只适用于其 allowlist，不能让任意新业务表直接暴露。

**Creator 画布与聊天：**
1. `app/creator/page.tsx` 认证后渲染 `components/creator/InfiniteCanvasReferenceHost.tsx`，路由在内嵌 React Router 中切换。
2. `reference/infinite-canvas/src/pages/canvas/project.tsx` 管理本地画布并调用 `lib/creator/canvas-client.ts`；`reference/infinite-canvas/src/stores/canvas/use-canvas-store.ts` 使用 Zustand + localforage。
3. `app/api/creator/canvases/route.ts` 解析所属 workspace、归一化图并持久化 `creator_canvases`；本地快照与服务端记录不能视为同一个存储层。
4. `/chat` 由 `app/chat/page.tsx` 装载会话；`app/api/creator/chat/route.ts` 编排文本模型、会话消息与费用，通用文本入口另见 `app/api/ai/chat/route.ts`。

**Creator 图片 / 视频生成与资产：**
1. `app/api/creator/images/route.ts`、`app/api/creator/videos/route.ts` 创建草稿、校验画布归属并返回参考素材上传路径；确认是独立请求。重复创建的冲突更新风险见 `.planning/codebase/CONCERNS.md`。
2. 图片确认 `app/api/creator/images/[id]/confirm/route.ts` → `lib/creator/image-confirm-route.ts` → `lib/creator/image-service.ts`：抢占 draft、检查参考素材 / 预算、必要账本写入后调用 provider；单次 draft 抢占不等于跨草稿重放的端到端幂等保证。
3. `lib/ai/image.ts`、`lib/ai/video.ts` 处理供应商协议；`lib/ai/wetoken-transport.ts` 提供出站 transport，服务端凭据不应进入浏览器。
4. 图片结果经 `persistGeneratedImage()` 写 NAS、`creator_assets` 与任务，再结算用量；证据：`lib/creator/image-confirm-route.ts`。文件与 DB 是跨资源写入，有补偿 / 未知结果处理，不是分布式原子事务。
5. 视频确认 `app/api/creator/videos/[id]/confirm/route.ts` 提交异步任务；`app/api/creator/videos/[id]/route.ts` GET 查询 provider 状态，`lib/creator/video-persistence.ts` 归档 NAS 并产生签名 URL。
6. 供应商受理不明确时保留 unknown / reconciliation 路径，不自动把未知提交当成失败重新付费生成；见 `lib/creator/video-task-reconciliation.ts`、`lib/creator/video-recovery.ts`。
7. 成片拼接由 `app/api/creator/productions/[productionId]/assembly/route.ts` 建持久 job 后在服务器调用 FFmpeg，见 `lib/creator/video-assembly.ts`；不走 Python 设备队列。

**本地媒体 Worker：**

以下是各模块的调用职责；当前 middleware 未放行独立 Worker 客户端，不能据此认定端到端可用，详见 `.planning/codebase/CONCERNS.md`。
1. 用户配对 → `lib/creator/media-worker-auth.ts` 创建一次性 pairing，数据库只存配对码 / bearer 的 digest；客户端入口见 `worker/src/fg_worker/__main__.py`。
2. `app/api/creator/media/jobs/route.ts` → `lib/creator/media-worker-queue.ts` 校验源资产、workspace 和幂等键，将处理任务写入 PostgreSQL。
3. Worker claim 按 user、operation、model profile 和容量匹配，以行锁 / `SKIP LOCKED` 获取租约；心跳、过期恢复和尝试次数由 `lib/creator/media-worker-queue.ts` 控制。
4. `worker/src/fg_worker/queue_loop.py` 下载 lease-bound input / mask、执行本地 operation、回报进度并分块上传；Worker 不接收任意 NAS 路径或 provider URL。
5. `lib/local/worker-storage.ts` 验证租约、字节数、SHA-256 和文件类型，移动最终文件并登记 `creator_assets` / 成功状态；磁盘与 DB 跨资源失败仍需按实现恢复。

**旧 Lab 状态与媒体：**
1. `app/api/production-lab/route.ts` 经 `labActor()` 和 same-origin 校验，再调用 `changeLab()`；`lib/production-lab/store.ts` 使用 `FOR UPDATE` 与 revision 防止覆盖同事更新。
2. 剧本 / 画布独立模块见 `lib/production-lab/script-runs.ts`、`lib/production-lab/canvas-storage.ts`；迁移位于 `production-lab/migrations/`，不是主站 `docker/initdb/`。
3. `app/api/production-lab/media/jobs/route.ts` 创建任务后触发提交，GET 同时唤醒队列与刷新有限数量的视频；这是请求驱动执行，不据此声称有独立常驻 Worker。
4. `lib/production-lab/media-runner.ts` 调 WeToken、归档 `production-lab-assets`，并关联主站费用账本；任务 / 素材索引在 Lab DB，见 `lib/production-lab/media-store.ts`。

**独立工作台与原生生成：**
1. `docker/nginx/default.conf` → `production-lab/meilin/gateway/server.mjs`；gateway 先处理退役 / 内部入口，再对普通请求向主站 `/api/auth/session` 校验 FG 身份。
2. gateway `canvasSession()` 在工作台 DB 映射 `users` / `fg_accounts` 并创建原生 `auth_sessions`，以 `open_ai_canvas_session` 代理到原生 web；主站 DB 不直接充当原生业务库。
3. `production-lab/meilin/canvas/web/src/services/api/request.ts` → Go handler 注册入口 `production-lab/meilin/canvas/backend/internal/handler/api.go` → service alias → app / 域包 → repository / model / database。
4. `production-lab/meilin/canvas/backend/internal/app/task_creation.go` 持久化任务；`production-lab/meilin/canvas/backend/internal/app/task_worker.go` 领取与续租，执行模型路由、恢复已受理任务，结果写资源层。
5. Redis 用于协调并发 / 限流等，任务实体仍持久化于数据库；证据：`production-lab/meilin/canvas/backend/internal/platform/coordination.go`、`production-lab/meilin/canvas/backend/internal/repository/repository_tasks.go`。
6. 原生资源写入先存对象再登记 Resource，失败不静默换本地盘，见 `production-lab/meilin/canvas/backend/internal/app/resource_store.go`；具体介质由存储配置决定，Compose 同时声明 NAS 挂载。
7. AdCraft / Meilin 等模型请求经内部 gateway bridge，隔离原生工作区与供应商凭据；入口见 `production-lab/meilin/gateway/fg-adcraft.mjs`、`production-lab/meilin/gateway/fg-meilin.mjs`。

**支持机器人：**
1. 飞书回调 `app/api/support-bot/events/route.ts` 校验事件并幂等入队；网页入口 `app/api/support-bot/web/route.ts` 校验用户与会话归属。
2. `scripts/support-bot-worker.ts` → `lib/support-bot/worker.ts` / `lib/support-bot/store.ts` 领取带租约任务，串联诊断、进度、交付记录。
3. 证据读取与产品原生服务边界见 `lib/support-bot/native-runtime.ts`、`lib/support-bot/tools.ts`、`production-lab/meilin/gateway/fg-support-native.mjs`；不是浏览器直接读取生产文件。

**State Management:**
- UI 偏好与画布缓存由 Zustand / localforage 管理，服务端业务行由 PostgreSQL 管理；例见 `stores/use-theme-store.ts`、`reference/infinite-canvas/src/stores/canvas/use-canvas-store.ts`、`docker/initdb/001-local.sql`。
- 主站、旧 Lab、原生工作台是不同持久化上下文；其中 Meilin FG 模式复用工作台连接，而 AdCraft workspace 使用独立 SQLite。证据：`lib/production-lab/store.ts`、`production-lab/meilin/compose.yml`、`production-lab/adcraft/upstream/apps/api/app/fg_backup.py`。
- 长任务的状态源是任务行 / 事件 / provider 关联，不是 React loading 状态；见 `lib/creator/video-task-events.ts`、`docker/initdb/013-local-media-workers.sql`。

## Key Abstractions

**Local Client / Query / Storage：**
- Purpose: 统一主站调用形状，不代替业务权限检查。
- Examples: `lib/local/server-client.ts`、`lib/local/client.ts`、`lib/local/db.ts`、`lib/local/storage.ts`。
- Pattern: Server adapter + browser HTTP facade；原始 SQL 用 `query()` / `withTransaction()`。

**Creator Workspace / Task / Asset：**
- Purpose: 按 owner 建创作空间，以 task 连接模型请求、节点、结果与账本。
- Examples: `lib/creator/workspace.ts`、`lib/creator/types.ts`、`docker/initdb/001-local.sql`。
- Pattern: owner upsert、draft-confirm、状态恢复、独立资产元数据与二进制文件。

**Usage Ledger / Provider Reference：**
- Purpose: 区分估算、服务商回报、账单核销；避免把时间 / 金额相似视为关联证据。
- Examples: `lib/usage/ledger.ts`、`lib/usage/wetoken-fee-reconciliation.ts`、`lib/usage/wetoken-reference.ts`。
- Pattern: 必要写入与 best-effort 更新分开；WeToken reference 有明确校验，不用猜测标识补全。

**Gateway Identity / Internal Capability：**
- Purpose: 在主站身份、原生用户、独立工具之间建立可信请求边界。
- Examples: `production-lab/meilin/gateway/server.mjs`、`production-lab/meilin/gateway/policy.mjs`、`production-lab/meilin/upstream/server/fg-contract.mjs`。
- Pattern: 每请求主站 session 校验 + 原生 session 映射；工具内部调用使用独立 capability / 签名契约。

## Entry Points

**主站应用：**
- Location: `app/layout.tsx`、`app/page.tsx`、`app/workspace/page.tsx`；启动脚本声明在 `package.json`。
- Triggers: Next 路由请求；`middleware.ts` 在匹配请求前执行。
- Responsibilities: 全局壳、登录门禁、工作区导航与业务页面组合。

**主站业务与后台：**
- Location: `app/api/creator/`、`app/api/ai/`、`app/projects/actions.ts`、`worker/src/fg_worker/__main__.py`、`scripts/support-bot-worker.ts`。
- Triggers: 浏览器 HTTP / Action、独立 Worker 轮询或显式 worker 启动。
- Responsibilities: API 编排、设备处理、支持任务执行；是否启用以配置与实测为准。

**独立生产工作台：**
- Location: `production-lab/meilin/gateway/server.mjs`、`production-lab/meilin/canvas/web/src/application.tsx`、`production-lab/meilin/canvas/backend/cmd/server/main.go`。
- Triggers: Nginx 分流及 `production-lab/meilin/compose.yml` 声明的独立进程启动。
- Responsibilities: 身份桥接、原生页面、生成 / 资源服务；子服务入口与退役限制见本文件 Layers。

## Error Handling

**Strategy:** HTTP 边界输出可识别状态码 / code 与安全消息；领域层保存失败状态、租约和关联证据。没有全仓统一的异常信封：Next 多用 `{ error, code }`，原生 Yingce 使用 `{ code, data, msg, reason }`，见 `app/api/creator/media/jobs/route.ts`、`production-lab/meilin/canvas/web/src/services/api/request.ts`。

**Patterns:**
- 主站 `LocalQuery` 将数据库异常转 `{ data, error }`，业务调用方检查后决定抛出 / 响应；事务异常回滚，见 `lib/local/db.ts`。
- NAS marker / disabled 状态不满足时拒绝媒体 I/O，而不是写入空挂载点；路径穿越与签名过期独立拒绝，见 `lib/local/storage.ts`。
- Provider 失败、未知提交、归档失败与账本失败分阶段记录，不把同一付费任务无条件重跑，见 `lib/creator/image-service.ts`、`lib/creator/video-persistence.ts`、`lib/creator/video-task-reconciliation.ts`。
- Worker API 使用业务错误 code / status，任务失败区分 retryable 与 terminal；租约决定写权限，见 `lib/creator/media-worker-queue.ts`、`lib/local/worker-storage.ts`。
- gateway 依赖不可用输出 503，退役路由输出 410；不在错误日志暴露 Cookie / DB URL / 凭据，见 `production-lab/meilin/gateway/server.mjs`、`production-lab/meilin/gateway/fg-retired-modules.mjs`。

## Cross-Cutting Concerns

**Logging:** `middleware.ts` 注入 trace；`lib/observability/server-log.ts` 做结构化与脱敏，`lib/observability/server-log-persistence.ts` 批量持久化，`lib/observability/audit-event.ts` 保存审计。原生组件证据走 `production-lab/meilin/gateway/support-observability.mjs` 与 `fg-support-native.mjs`，不能仅凭一个组件版本代表全部子服务。

**Validation:** API 边界做大小 / 类型 / 所属权校验，领域模块校验图与生成参数，DB 提供唯一约束 / 事务；见 `lib/creator/canvas-graph.ts`、`lib/creator/image.ts`、`lib/local/db.ts`。旧 Lab 访问实际是 enabled 且存在 role，不应沿用 README 的 superadmin-only 描述，见 `lib/production-lab/access-policy.ts`、`lib/production-lab/access.ts`。

**Authentication:** FG session 在 `lib/local/auth.ts` 验证；Worker 在 `lib/creator/media-worker-auth.ts` 验证 bearer；独立 gateway 向主站验 session 并创建原生 session。业务内部 secret 与原生 support token 是不同权限域，见 `production-lab/meilin/gateway/fg-support-native.mjs`。

---

*Architecture analysis: 2026-11-05*
