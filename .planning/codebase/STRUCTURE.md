# Codebase Structure

**Analysis Date:** 2026-11-05

## Directory Layout

```text
fgai-app/
├── AGENTS.md                       # 仓库约束与生产守护进程保护
├── .codex-memory/                  # 项目记忆索引与部署约束
├── .planning/codebase/             # 静态 onboarding 地图
├── app/                            # Next.js App Router 页面、Actions、HTTP API
│   ├── layout.tsx                  # 全局版本门禁、主题与错误采集
│   ├── page.tsx                    # Landing
│   ├── login/                      # 登录
│   ├── workspace/                  # 工作区聚合入口
│   ├── projects/[id]/              # bible/script/assets/board/shots/video/bgm/export
│   ├── creator/                    # 内嵌画布工作区及旧 image/video/canvas 入口
│   ├── canvas/                     # 旧画布 URL 重定向
│   ├── chat/                       # 独立 Creator 对话页
│   ├── admin/                      # 管理、费用和日志
│   ├── me/                         # 个人页
│   ├── presets/                    # 预设页
│   ├── production-lab/             # Next 内旧 Lab 页面
│   └── api/                        # auth/local/ai/creator/production-lab/observability/support-bot/version
├── components/                     # 主站 UI 与业务编排组件
│   ├── creator/                    # Creator host、对话、生成与费用 UI
│   ├── canvas/                     # 主站画布及 nodes
│   ├── studio/                     # 项目制作 UI
│   ├── production-lab/             # Next 内旧 Lab UI
│   ├── logs/                       # 日志查看组件
│   └── react-bits/                 # 视觉效果组件
├── reference/infinite-canvas/src/   # 被主站直接 import 的内嵌画布源码
├── lib/                            # 领域逻辑、业务客户端、基础设施
│   ├── local/                      # PostgreSQL、session、NAS、Worker 文件 I/O
│   ├── creator/                    # workspace/task/asset/canvas/production/worker
│   ├── ai/                         # 模型目录、文本/图/视频/音频、WeToken transport
│   ├── canvas/                     # 节点注册、Agent 操作与引用关系
│   ├── usage/                      # 预算、价格、账本、WeToken 对账
│   ├── production-lab/             # 旧 Lab 领域、独立 DB、媒体队列
│   ├── observability/              # 结构化日志、审计、报表
│   ├── support-bot/                # 支持队列、诊断工具、原生证据适配
│   └── auth/                       # 公司邮箱、公开演示等身份策略
├── stores/                         # 主站共享状态；不包含所有画布 store
├── hooks/                          # 主站共享 hook
├── types/                          # 媒体、Worker、画布与插件等共享类型
├── constant/                       # 画布常量
├── worker/                         # 独立 Python 本地媒体 Worker
│   ├── src/fg_worker/              # CLI、配对、HTTP 客户端、队列、operations
│   ├── packaging/                  # macOS / Windows 分发入口
│   └── tests/                      # 已有 Python 专项测试
├── docker/                         # 主站 DB 初始化与 Nginx 配置
│   ├── initdb/                     # 主站有序 SQL 迁移
│   └── nginx/default.conf          # 主站/独立工作台的真实路径分流
├── scripts/                        # 迁移、监测、部署、日志与支持 Worker 脚本
├── production-lab/                 # 旧 Lab 支撑 + 独立产品源码/集成，不是单一 Next 模块
│   ├── migrations/                # 旧 Lab 独立库迁移
│   ├── prototype/                 # 旧 Lab 本地无 API 预览
│   ├── tests/                     # 旧 Lab 专项测试与预览打包入口
│   ├── yingce/                    # 独立工作台组合与 FG 适配
│   │   ├── compose.yml            # PostgreSQL/Redis/Agent/backend/web/gateway/工具服务
│   │   ├── gateway/               # Node gateway、fg-*.mjs、FG 扩展表
│   │   └── canvas/                # 原生 Yingce 源码；有下级 AGENTS.md
│   │       ├── web/               # React/Vite 原生工作台
│   │       ├── backend/           # Go HTTP、领域、数据库、任务与存储
│   │       ├── yingce-agent/      # 独立 Node Agent 服务
│   │       └── docs/              # 原生文档站
│   ├── adcraft/{deploy,upstream}/  # 广告原生应用与 FG 构建层
│   ├── meilin/{deploy,upstream}/   # 美林编导应用与 FG 模式服务
│   ├── opencreator/               # Web/Daemon/Desktop 源码与保留的 runtime 适配
│   │   ├── deploy/                # 私有运行包装、媒体、回收与配置
│   │   └── upstream/              # apps/web、apps/daemon、apps/desktop、packages
│   ├── arcreel/{deploy,upstream}/  # 保留的导演应用与私有 runtime 适配
│   └── suno/                      # 私有音乐 HTTP adapter 与 provider 实现
├── tests/                         # 主站既有 TypeScript 专项测试
├── public/                        # 主站静态媒体、图标、画布配置
├── docs/                          # 发布、专项功能与运维说明
├── middleware.ts                  # 请求 trace 与 session 门禁
├── next.config.mjs                # Next standalone、本地联调 rewrite
├── tsconfig.json                  # @/* -> 仓库根；排除 production-lab
├── package.json                   # 主站命令与依赖
├── Dockerfile                     # 主站镜像
├── docker-compose.yml             # 主站服务组合
└── docker-compose.nas.yml         # NAS 挂载覆盖配置
```

树保留实际关键目录，省略 upstream 内的非入口实现、依赖、缓存和产物；`production-lab/` 跟踪文件约 1.55 万，不应逐个当作主站模块分析。构建与编译边界以 `package.json`、`tsconfig.json`、`production-lab/meilin/compose.yml` 为准。

## Directory Purposes

**`app/` 与 `components/`：**
- Purpose: Next 请求入口、页面装载、Server Actions 与浏览器 UI；页面不是所有业务逻辑的归宿。
- Contains: `page.tsx`、`route.ts`、`actions.ts` 以及按业务分组的组件；项目子模块在 `app/projects/[id]/`。
- Key files: `app/layout.tsx`、`app/workspace/page.tsx`、`app/projects/actions.ts`、`components/creator/InfiniteCanvasReferenceHost.tsx`。

**`reference/infinite-canvas/src/`：**
- Purpose: 主站 `/creator` 真正使用的画布前端，修改 Creator 内页前优先定位这里，不能只改同名旧组件。
- Contains: pages、layouts、components、stores、lib 与类型；通过主站业务客户端连接 Creator API。
- Key files: `reference/infinite-canvas/src/pages/canvas/project.tsx`、`reference/infinite-canvas/src/stores/canvas/use-canvas-store.ts`、`components/creator/InfiniteCanvasReferenceHost.tsx`。

**`lib/local/`、`lib/creator/`、`lib/ai/`、`lib/usage/`：**
- Purpose: 依次承载本地基础设施、创作领域、模型协议和费用语义；不能把 provider 协议塞进 UI。
- Contains: DB / storage adapter、任务状态机、草稿校验、资产归档、业务客户端、预算 / ledger。
- Key files: `lib/local/db.ts`、`lib/local/storage.ts`、`lib/creator/image-service.ts`、`lib/ai/video.ts`、`lib/usage/ledger.ts`。

**`worker/`：**
- Purpose: 独立安装的 Python 设备 Worker，不属于 Next bundle，也不是 Yingce Agent。
- Contains: CLI / 配对 / capabilities / 队列循环 / 本地媒体 operations / 打包脚本；服务器协议实现仍在主站。
- Key files: `worker/src/fg_worker/__main__.py`、`worker/src/fg_worker/queue_loop.py`、`lib/creator/media-worker-queue.ts`、`lib/local/worker-storage.ts`。

**`lib/production-lab/`、`components/production-lab/`、`production-lab/migrations/`：**
- Purpose: Next 内旧 Lab 的领域、UI 和独立数据库，不是独立 Yingce 的前后端源码。
- Contains: JSON 领域状态、revision 命令、剧本 / 画布持久化、媒体与团队核算。
- Key files: `lib/production-lab/domain.ts`、`lib/production-lab/store.ts`、`components/production-lab/CreativeWorkspace.tsx`、`production-lab/migrations/005-media-queue-and-assets.sql`。

**`production-lab/meilin/gateway/`：**
- Purpose: FG 与独立生产产品的主要维护接缝：认证、身份映射、费用、内部模型 bridge、协作和公开入口策略。
- Contains: `server.mjs` 组合根、`fg-*.mjs` 域模块、扩展 schema、专项测试。
- Key files: `production-lab/meilin/gateway/server.mjs`、`production-lab/meilin/gateway/policy.mjs`、`production-lab/meilin/gateway/fg-integration.mjs`、`production-lab/meilin/gateway/fg-schema.sql`。

**`production-lab/meilin/canvas/`：**
- Purpose: 独立原生工作台；其 web、backend、Agent、docs 各有构建 / 运行边界，不走主站 TypeScript 编译。
- Contains: `web/src/` 页面、API service、store；`backend/internal/` handler、service aliases、app / 域、repository / model / storage；独立 `yingce-agent/`。
- Key files: `production-lab/meilin/canvas/AGENTS.md`、`production-lab/meilin/canvas/web/src/application.tsx`、`production-lab/meilin/canvas/backend/cmd/server/main.go`、`production-lab/meilin/canvas/yingce-agent/server.mjs`。

**`production-lab/adcraft/` 与 `production-lab/meilin/`：**
- Purpose: 可独立部署的产品与 FG 集成；`deploy/` 负责镜像包装，`upstream/` 也包含 FG 入口，不可整体覆盖。
- Contains: AdCraft React / Python API / Pi Agent，Meilin React / Node FG server；服务组合声明见 `production-lab/meilin/compose.yml`。
- Key files: `production-lab/adcraft/upstream/apps/api/fg_main.py`、`production-lab/adcraft/upstream/apps/api/app/fg_backup.py`、`production-lab/meilin/upstream/server/fg-server.mjs`、`production-lab/meilin/upstream/server/fg-store.mjs`。
- Storage: AdCraft workspace SQLite 在本机持久卷，媒体和备份在 NAS；Meilin FG 模式元数据在工作台 PostgreSQL，上传在 NAS。证据：`production-lab/adcraft/upstream/apps/api/app/fg_backup.py`、`production-lab/meilin/compose.yml`。

**`production-lab/opencreator/`、`production-lab/arcreel/`、`production-lab/suno/`：**
- Purpose: 前两者保留原生源码与私有 runtime 包装；Suno 是独立音乐 provider adapter，不能因目录存在就断言服务开放。
- Contains: OpenCreator `apps/web` / `apps/daemon` / `apps/desktop`；ArcReel `frontend` / `server` / `agent_runtime` / `lib`；Suno `server.ts` / `current-api.mjs` / `contract.mjs`。
- Key files: `production-lab/opencreator/deploy/entry.mjs`、`production-lab/arcreel/deploy/entry.py`、`production-lab/suno/server.ts`。
- Storage / exposure: OpenCreator 与 ArcReel 包装分离私有 state 和 NAS workspace；Suno state 保存 operation JSON / MP3。Creator Web、ArcReel / Director 等 gateway 入口明确退役返回 410，见 `production-lab/meilin/gateway/fg-retired-modules.mjs`，不能据旧 README 启动或恢复。

**`docker/`、`scripts/`、`lib/observability/`、`lib/support-bot/`：**
- Purpose: 主站基础设施声明、运维脚本、日志 / 审计和支持任务；静态阅读脚本不等于运行授权。
- Contains: SQL、Nginx、部署 / NAS / monitor 脚本、日志查询、机器人租约队列与证据适配。
- Key files: `docker/nginx/default.conf`、`scripts/local-db-migrate.mjs`、`scripts/support-bot-worker.ts`、`lib/observability/server-log.ts`、`lib/support-bot/store.ts`。

## Key File Locations

**Entry Points:**
- `app/layout.tsx`、`middleware.ts`：全局页面壳、请求 trace 和初步 session 门禁。
- `app/workspace/page.tsx`、`app/creator/page.tsx`、`app/chat/page.tsx`：工作区、嵌入式画布、对话入口。
- `app/projects/[id]/page.tsx`：项目入口转向 bible；`app/projects/[id]/script/actions.ts`：剧本写路径。
- `app/api/creator/images/[id]/confirm/route.ts`、`app/api/creator/videos/[id]/route.ts`：生成确认与视频查询 / 恢复边界。
- `worker/src/fg_worker/__main__.py`、`scripts/support-bot-worker.ts`：独立设备 Worker 与支持任务进程入口。
- `production-lab/meilin/gateway/server.mjs`：生产工作台 gateway 的 3010 主入口及 3020 退役响应入口（源码默认）。
- `production-lab/meilin/canvas/backend/cmd/server/main.go`、`production-lab/meilin/canvas/web/src/application.tsx`：原生 Go 后端与 React SPA。
- `production-lab/adcraft/deploy/Dockerfile.api`、`production-lab/meilin/deploy/Dockerfile`、`production-lab/suno/package.json`：独立工具真实启动命令。

**Configuration:**
- `package.json`、`pnpm-lock.yaml`、`next.config.mjs`、`tsconfig.json`：主站依赖、构建、rewrite 与 alias；`tsconfig.json` 排除 `production-lab`。
- `docker-compose.yml`、`docker-compose.nas.yml`、`Dockerfile`：主站 app / PostgreSQL / Nginx / tunnel 与 NAS 组合。
- `production-lab/meilin/compose.yml`、`production-lab/meilin/tls.conf`：独立工作台服务依赖、挂载与入口代理；不代表当前实际运行清单。
- `production-lab/meilin/canvas/backend/internal/database/`、`production-lab/meilin/canvas/backend/internal/platform/coordination.go`：原生数据库及 Redis 协调实现。
- `.codex-memory/project_deployment_version.md`、`lib/version.ts`、`app/api/version/route.ts`：部署版本合同及对外版本接口；不读取实际 `.env` 值来生成地图。

**Core Logic:**
- `lib/local/auth.ts`、`lib/local/db.ts`、`lib/local/storage.ts`：身份、参数化查询 / 事务、NAS 保护与签名 URL。
- `lib/creator/image-service.ts`、`lib/creator/image-confirm-route.ts`、`lib/creator/video-persistence.ts`：图片确认状态机、结果持久化、视频归档。
- `lib/creator/media-worker-auth.ts`、`lib/creator/media-worker-queue.ts`、`lib/local/worker-storage.ts`：设备权限、租约与结果上传闭环。
- `lib/ai/catalog.ts`、`lib/ai/video-models.ts`、`lib/ai/wetoken-transport.ts`：模型能力与服务商出站协议。
- `lib/usage/ledger.ts`、`lib/usage/wetoken-fee-reconciliation.ts`：用量语义与精确对账。
- `production-lab/meilin/canvas/backend/internal/app/task_creation.go`、`production-lab/meilin/canvas/backend/internal/app/task_worker.go`：原生任务入队、领取、续租与执行恢复。
- `production-lab/meilin/gateway/fg-adcraft.mjs`、`production-lab/meilin/gateway/fg-meilin.mjs`：独立工具与统一模型 / 费用边界的桥接。

**Testing:**
- `tests/`：主站已有 `*.test.ts`，运行方式声明在 `package.json`；本次未执行。
- `worker/tests/`：Python Worker 已有专项测试；`worker/pyproject.toml` 为其项目配置。
- `production-lab/tests/`：旧 Lab `*.test.cjs`；`production-lab/meilin/gateway/`：Node `*.test.mjs`。
- `production-lab/meilin/canvas/backend/internal/`：Go 就近 `*_test.go`；原生前端与各 upstream 也有各自测试，遵循各自入口和下级 `AGENTS.md`，不由主站命令统一覆盖。

## Naming Conventions

**Files:**
- Next 约定入口：`page.tsx` / `layout.tsx` / `route.ts` / `actions.ts`，例如 `app/creator/page.tsx`、`app/projects/actions.ts`。
- 业务组件通常 PascalCase，领域模块与 hook 多为 kebab-case；例 `components/creator/InfiniteCanvasReferenceHost.tsx`、`lib/creator/video-recovery.ts`、`hooks/use-copy-text.ts`。旧文件仍有 camelCase，如 `lib/chatStore.ts`，不借地图统一改名。
- gateway 适配使用 `fg-*.mjs`；Python 使用 snake_case，Go 测试使用 `*_test.go`；例 `production-lab/meilin/gateway/fg-public-entry.mjs`、`worker/src/fg_worker/queue_loop.py`。
- 迁移有序前缀分属主站与旧 Lab：`docker/initdb/013-local-media-workers.sql`、`production-lab/migrations/005-media-queue-and-assets.sql`，不要混用。

**Directories:**
- 路由参数用 `[id]` / `[...slug]`，例 `app/projects/[id]/`、`app/canvas/[...slug]/`；主站导入 alias `@/*` 指向仓库根，见 `tsconfig.json`。
- `upstream/` 表示引入的产品树，`deploy/` 表示集成包装，不保证 upstream 未修改；例 `production-lab/adcraft/upstream/apps/api/fg_main.py`。

## Where to Add New Code

**New Feature:**
- Primary code: 主站页面放 `app/<业务>/`，UI 放对应 `components/`，领域逻辑放 `lib/<业务>/`，HTTP 放 `app/api/<业务>/`；参照 `app/api/creator/canvases/route.ts` 与 `lib/creator/canvas-graph.ts`。
- Creator 内嵌画布功能先改真实入口 `reference/infinite-canvas/src/pages/` / `stores/` / `lib/`，通过 `lib/creator/*-client.ts` 接服务端；不要另造一套 Creator 前端。
- 旧 Lab 功能放 `lib/production-lab/` / `components/production-lab/` / `app/api/production-lab/`；独立 `/fg-six/` 能力放 gateway 或原生应用，不把两个 Lab 混成一个实现。
- Tests: 用户要求新增测试时按既有边界放 `tests/`、`worker/tests/`、gateway 就近测试或原生应用测试目录；不因地图任务自动生成测试。

**New Component/Module:**
- Implementation: 主站共享组件放 `components/`，模块私有 UI 留业务子目录；先查 `package.json` 与现有组件复用 antd / dayjs 等，约束见 `AGENTS.md`。
- 模型 payload / 解析归 `lib/ai/`，任务编排归 `lib/creator/`，费用归 `lib/usage/`，NAS 文件操作归 `lib/local/`；参照 `lib/creator/image-confirm-route.ts` 的依赖方向。
- 本地媒体操作放 `worker/src/fg_worker/operations/`，同时维护服务器合同与 capabilities；入口参照 `worker/src/fg_worker/operations/registry.py`、`types/media-worker.ts`。
- 独立服务的 FG 身份 / 预算 / 路由桥接放 `production-lab/meilin/gateway/`；镜像与包装放对应 `deploy/`，产品业务放其原生源码。修改前读 `production-lab/meilin/canvas/AGENTS.md`、`production-lab/opencreator/upstream/AGENTS.md` 或 `production-lab/arcreel/upstream/AGENTS.md`。
- Yingce 后端按 handler → service alias → app / 域 → repository / model 分层；新 SQL 不塞进 handler。原生前端 API 走 `production-lab/meilin/canvas/web/src/services/api/request.ts`，不另建请求客户端。

**Utilities:**
- Shared helpers: 主站通用纯函数用 `lib/utils.ts` 或所属域已有模块；共享协议类型放 `types/`，参考 `types/media-worker.ts`，避免跨独立服务直接 import 主站内部状态。
- 数据结构变化归所属迁移入口：主站 `docker/initdb/`，旧 Lab `production-lab/migrations/`，原生 Yingce `production-lab/meilin/canvas/backend/internal/database/`；gateway 扩展 schema 参照 `production-lab/meilin/gateway/fg-schema.sql`。

## Special Directories

**`production-lab/` 与 `reference/`：**
- Purpose: 前者聚合多个产品与集成，后者包含主站实际运行源码；不能都归为可忽略 vendor，证据见 `components/creator/InfiniteCanvasReferenceHost.tsx`、`production-lab/meilin/compose.yml`。
- Generated: 主体不是生成目录；子树内缓存 / 构建产物另论，忽略规则见 `production-lab/.gitignore`、`production-lab/meilin/.gitignore`。
- Committed: 两者均有跟踪源码；upstream 更新须保留 FG 修改、许可和下级协作规则。

**`.next/`、`node_modules/`、`.worktrees/`、本地缓存：**
- Purpose: 构建产物、安装依赖、并行 checkout 或本机缓存，不是新增业务代码落点；根 `.gitignore` 忽略前三者。
- Generated: 是 / 工具管理；`production-lab/meilin/canvas/.local/` 也属于原生本地开发上下文，规则见 `production-lab/meilin/canvas/AGENTS.md`。
- Committed: 根 `.next/`、`node_modules/`、`.worktrees/` 不跟踪；不要把本机存在性当成部署状态。

**`.codex-memory/` 与 `.planning/codebase/`：**
- Purpose: 长期项目约束与静态代码地图；前者入口为 `.codex-memory/MEMORY.md`，后者保存技术栈、架构、目录、惯例、测试、集成和风险七份地图。
- Generated: 前者人工维护；后者由 mapper 基于静态证据生成。
- Committed: `.codex-memory/MEMORY.md` 已跟踪；`.planning/codebase/` 地图按仓库文档管理。守护服务保护以 `AGENTS.md` 为准，不因文档映射操作任何 daemon。

---

*Structure analysis: 2026-11-05*
