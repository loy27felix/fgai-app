# Technology Stack

**Analysis Date:** 2026-11-05

## Languages

**Primary:**
- TypeScript：主应用使用 React TSX、Next.js Route Handlers 与服务端业务模块。
  - 版本：manifest 要求 `^5.5.4`，lockfile 解析为 **5.9.3**。依据：`package.json`、`pnpm-lock.yaml`。
  - 入口：`app/layout.tsx`、`app/api/version/route.ts`、`lib/`。
- 主应用编译目标为 ES2020，启用 `strict`、`noEmit`、`moduleResolution: bundler`，别名 `@/*` 指向仓库根；`production-lab` 被显式列入 exclude，不能用主应用检查替代独立栈检查。依据：`tsconfig.json`。

**Secondary:**
- Python **>=3.11**：独立 GPU/media worker。
  - 包名 `fg-studio-worker`，版本 **0.1.0**。依据：`worker/pyproject.toml`。
  - CLI 为 `fg-worker`。依据：`worker/pyproject.toml`、`worker/src/fg_worker/__main__.py`。
- Go **1.25.0**：Yingce/Canvas 后端的模块语言版本；不代表已核实宿主机 Go 版本。依据：`production-lab/yingce/canvas/backend/go.mod`。
- Python **>=3.12**：ArcReel 后端；Python **>=3.10.12**：AdCraft 后端。两者拥有独立依赖图，不属于根 Node 应用依赖。依据：`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/adcraft/upstream/apps/api/pyproject.toml`。
- JavaScript ESM：第六板块 gateway、Meilin 服务、OpenCreator adapter 与部署工具。依据：`production-lab/yingce/gateway/server.mjs`、`production-lab/meilin/upstream/server/fg-server.mjs`、`production-lab/opencreator/deploy/entry.mjs`。
- SQL 与 Shell：PostgreSQL schema/升级、部署与存储守护；Python 也用于独立栈 provisioning。依据：`docker/initdb/`、`production-lab/migrations/`、`scripts/auto-deploy.sh`、`production-lab/arcreel/deploy/provision.py`。

## Runtime

**Environment:**
- 主应用容器基于 **Node.js 20 Alpine**。依据：`Dockerfile`。
  - 构建后以非 root 用户执行 standalone `server.js`，镜像安装 FFmpeg。依据：`Dockerfile`。
  - 镜像 tag 未固定 patch/digest，不能推导实际生产二进制版本。依据：`Dockerfile`。
- 浏览器运行 React UI；服务端 API 使用 Node 能力，middleware 使用 Next middleware API；不要把整个应用当作纯 SPA 或全 Edge 服务。依据：`app/layout.tsx`、`lib/local/db.ts`、`middleware.ts`。
- Python worker 使用 HTTP 客户端与外部媒体/model runner；GPU 后端包含 CUDA、MPS、CPU 的能力表达，是否安装/可用需运行时探测。依据：`worker/src/fg_worker/capabilities.py`、`worker/src/fg_worker/operations/video_super_resolution.py`、`worker/src/fg_worker/runtime_config.py`。
- 独立栈镜像基线不同：gateway 为 Node 20 Alpine，Meilin 为 Node 22 Alpine，OpenCreator 构建/运行阶段基于 Node 22 Bookworm，ArcReel 前端构建阶段为 Node 24。不能统一套用根 Dockerfile。依据：`production-lab/yingce/gateway/Dockerfile`、`production-lab/meilin/deploy/Dockerfile`、`production-lab/opencreator/deploy/Dockerfile`、`production-lab/arcreel/deploy/Dockerfile`。
- Suno 服务基于 Playwright **1.61.1 Noble** 镜像，TypeScript 由 `tsx` 加载，不是根 Next.js 的 API 子模块。依据：`production-lab/suno/Dockerfile`、`production-lab/suno/package.json`。

**Package Manager:**
- 主应用固定 **pnpm 9.15.0**。依据：`package.json`。
  - Docker 构建使用 `pnpm install --frozen-lockfile`。依据：`Dockerfile`。
  - Lockfile 存在，格式版本 **9.0**；依赖升级应同步 manifest 与 lock。依据：`pnpm-lock.yaml`、`Dockerfile`。
- Python worker 使用 setuptools **>=69**；manifest 给出依赖下界，worker 根未见独立 lockfile，因此不记录假定的安装版本。依据：`worker/pyproject.toml`、`worker/`。
- Canvas Web 固定 **Bun 1.3.9**，依赖锁为 `bun.lock`；backend 使用 `go.mod`/`go.sum`，Pi runtime 另有 Node manifest。依据：`production-lab/yingce/canvas/web/package.json`、`production-lab/yingce/canvas/web/bun.lock`、`production-lab/yingce/canvas/backend/go.mod`、`production-lab/yingce/canvas/backend/go.sum`、`production-lab/yingce/canvas/backend/agent-runtime/pi/package.json`。
- ArcReel 使用 uv 与独立 `uv.lock`；frontend 固定 pnpm **10.33.2**，要求 Node **>=24.12.0**。依据：`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/arcreel/upstream/uv.lock`、`production-lab/arcreel/upstream/frontend/package.json`。
- AdCraft Python 使用 `uv.lock`；其 Web/Agent、gateway、Meilin、Suno 使用各自 npm lockfile，不共享根 pnpm lock。依据：`production-lab/adcraft/upstream/apps/api/uv.lock`、`production-lab/adcraft/upstream/apps/web/package-lock.json`、`production-lab/adcraft/upstream/apps/api/agent/package-lock.json`、`production-lab/yingce/gateway/package-lock.json`、`production-lab/meilin/upstream/package-lock.json`、`production-lab/suno/package-lock.json`。
- OpenCreator 是独立 pnpm **9.15.0** workspace，不是主应用 workspace 成员。依据：`production-lab/opencreator/upstream/package.json`、`production-lab/opencreator/upstream/pnpm-workspace.yaml`、`production-lab/opencreator/upstream/pnpm-lock.yaml`。

## Frameworks

**Core:**
- 主项目 `fg-studio` manifest 版本 **1.6.1**。依据：`package.json`。
  - 核心版本：**Next.js 14.2.15 + React/React DOM 18.3.1**。依据：`package.json`、`pnpm-lock.yaml`。
  - 运行方式：App Router、Route Handlers、standalone 输出。依据：`app/layout.tsx`、`app/api/version/route.ts`、`next.config.mjs`。
- 主 UI：**Ant Design 5.29.3**、Pro Components **2.8.10**、Tailwind CSS **3.4.19**；这里列 lockfile 解析版本，不把 manifest 范围当实际版本。依据：`package.json`、`pnpm-lock.yaml`、`tailwind.config.ts`、`postcss.config.mjs`。
- 主应用状态/数据层：Zustand **5.0.14**、TanStack Query **5.101.4**、localForage **1.10.0**；数据库通过 `pg` 与项目本地 client/query abstraction 连接，而非引入大型 ORM。依据：`pnpm-lock.yaml`、`lib/localforage-storage.ts`、`lib/local/db.ts`、`lib/local/client.ts`。
- Canvas Web：React **19.2.7**、Vite **8.1.5**、TypeScript **7.0.2**、Ant Design **6.5.1**、Tailwind **4.3.3**；与主应用版本不同。依据：`production-lab/yingce/canvas/web/package.json`、`production-lab/yingce/canvas/web/bun.lock`。
- Canvas backend：Gin **1.12.0**、GORM **1.31.2**，支持 PostgreSQL/SQLite；集成编排选 PostgreSQL。依据：`production-lab/yingce/canvas/backend/go.mod`、`production-lab/yingce/canvas/backend/internal/database/database.go`、`production-lab/yingce/compose.yml`。
- Yingce Pi runtime：`@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` 均固定 **0.87.1**，manifest 要求 Node **>=22.19.0**；生产编排提供独立 `yingce-agent` 服务。依据：`production-lab/yingce/canvas/backend/agent-runtime/pi/package.json`、`production-lab/yingce/compose.yml`。
- AdCraft：FastAPI **0.136.3**、SQLAlchemy **2.0.51**、OpenAI Python **2.38.0**；前端 lock 解析 React **19.2.7**、Vite **7.3.5**。依据：`production-lab/adcraft/upstream/apps/api/uv.lock`、`production-lab/adcraft/upstream/apps/web/package-lock.json`。
- Meilin：React **18.3.1**、Vite **5.4.11**，后端使用原生 `node:http` 与 `pg 8.13.1`，并非 FastAPI 服务。依据：`production-lab/meilin/upstream/package-lock.json`、`production-lab/meilin/upstream/server/fg-server.mjs`、`production-lab/meilin/upstream/server/fg-store.mjs`。
- ArcReel：manifest 项目版本 **0.33.0**；后端 lock 解析 FastAPI **0.141.1**、SQLAlchemy **2.0.52**、Claude Agent SDK **0.2.163**；前端 lock 解析 React **19.3.0**、Vite **8.3.2**。这是内嵌源码依赖，不代表入口仍开放。依据：`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/arcreel/upstream/uv.lock`、`production-lab/arcreel/upstream/frontend/pnpm-lock.yaml`、`production-lab/yingce/gateway/fg-retired-modules.mjs`。
- OpenCreator：Web 使用 React 18/Vite 6，Daemon 使用 Fastify **5.12.2** 与 better-sqlite3 **12.11.1**，另含 Desktop；FG 当前 gateway 将旧 Creator 页面入口列为 retired。依据：`production-lab/opencreator/upstream/apps/web/package.json`、`production-lab/opencreator/upstream/apps/daemon/package.json`、`production-lab/opencreator/upstream/apps/desktop/package.json`、`production-lab/opencreator/upstream/pnpm-lock.yaml`、`production-lab/yingce/gateway/fg-retired-modules.mjs`。

**Testing:**
- 主应用测试工具为 **tsx 4.23.1 + Node test runner**。依据：`package.json`、`pnpm-lock.yaml`。
  - Manifest 命令：`tsx --test tests/**/*.test.ts`。依据：`package.json`。
  - 本轮按授权只做文档静态检查，没有执行测试。测试源码入口为 `tests/`。
- Worker 有 pytest 风格函数测试，但 worker manifest 未声明 pytest/dev 测试组；不能仅据目录保证测试环境已具备。依据：`worker/tests/test_queue_loop.py`、`worker/pyproject.toml`。
- gateway、Meilin、Suno 使用 Node `--test`；独立栈测试不由根 `test` 脚本统一覆盖。依据：`production-lab/yingce/gateway/package.json`、`production-lab/meilin/upstream/package.json`、`production-lab/suno/package.json`、`package.json`。
- ArcReel、AdCraft 声明 pytest；OpenCreator 声明 Vitest/Playwright；Canvas 提供 Bun 测试和 Go 测试入口。此处只映射工具，不评价覆盖率或通过状态。依据：`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/adcraft/upstream/apps/api/pyproject.toml`、`production-lab/opencreator/upstream/package.json`、`production-lab/yingce/canvas/web/package.json`、`production-lab/yingce/canvas/AGENTS.md`。

**Build/Dev:**
- 主应用脚本为 `next dev`、`next build`、`next start`、`next lint`；manifest 中存在 lint 命令不等于本轮已验证其可执行性。依据：`package.json`。
- Tailwind 通过 PostCSS/Autoprefixer 集成，锁定 PostCSS **8.5.15**、Autoprefixer **10.5.0**；主题采用 class dark mode 与 CSS variables。依据：`postcss.config.mjs`、`tailwind.config.ts`、`pnpm-lock.yaml`。
- Next 配置限制构建 CPU 为 1，Server Actions body limit 为 2 MB；Docker 构建另设 Node/Rayon 资源参数并校验 standalone 产物存在。依据：`next.config.mjs`、`Dockerfile`。
- 本地 `FG_LOCAL_WORKBENCH=true` 且处于 development 时，Next 将 `/fg-six` 的 API/页面分别转发至本机 gateway/Web，并重定向旧 `/production-lab` 入口。只表示路由配置，不证明服务已启动。依据：`next.config.mjs`。

## Key Dependencies

**Critical:**
- `pg`：数据库客户端各运行栈独立解析版本，不应混写成全仓同版本。
  - 主应用 manifest 为 `^8.13.1`，根 lock 实际为 **8.23.0**。依据：`package.json`、`pnpm-lock.yaml`、`lib/local/db.ts`。
  - gateway/Meilin 独立锁定 **8.13.1**。依据：`production-lab/yingce/gateway/package-lock.json`、`production-lab/meilin/upstream/package-lock.json`。
- `openai` **7.43.0**：主应用 Support Bot 的 Responses SDK；普通文本/图片/视频调用另走 fetch-based provider adapter。依据：`pnpm-lock.yaml`、`lib/support-bot/model.ts`、`lib/ai/wetoken-client.ts`、`lib/ai/image.ts`、`lib/ai/video.ts`。
- `undici` **7.29.0**：主应用 WeToken 出站 dispatcher；不能据 SDK 存在就推断所有请求均由 OpenAI SDK 发出。依据：`pnpm-lock.yaml`、`lib/ai/wetoken-transport.ts`、`lib/ai/wetoken-client.ts`。
- `@larksuiteoapi/node-sdk` **1.76.0**：Feishu 消息回复、reaction 与 Bitable；axios 为自定义 HTTP transport 的组成部分。依据：`pnpm-lock.yaml`、`lib/support-bot/feishu.ts`。
- Python worker：`httpx>=0.27`、`keyring>=25`、`platformdirs>=4`、`psutil>=6`、`pydantic>=2`，可选 `torch>=2.4`；没有据此推断模型权重已经安装。依据：`worker/pyproject.toml`、`worker/src/fg_worker/credentials.py`、`worker/src/fg_worker/client.py`。
- 媒体能力包括 FFmpeg、超分与去水印 adapter；operation registry 只注册 `video_super_resolution`、`watermark_removal`，具体 runner/profile 与依赖以运行配置为准。依据：`Dockerfile`、`worker/src/fg_worker/operations/registry.py`、`worker/src/fg_worker/operations/video_super_resolution.py`、`worker/src/fg_worker/operations/watermark_removal.py`。

**Infrastructure:**
- 主 Compose 声明 **PostgreSQL 16 Alpine**、可选 HTTPS Nginx 和 Cloudflare Tunnel；数据库数据位于命名 volume，媒体存储另行挂载。依据：`docker-compose.yml`、`docker-compose.nas.yml`。
- 第六板块 Compose 声明独立 **PostgreSQL 17 Alpine**、**Redis 7.4 Alpine**、migrate、backend、agent、web、gateway、TLS，以及 AdCraft/Creator Web/可选 Meilin。声明不等于当前容器 inventory。依据：`production-lab/yingce/compose.yml`。
- Canvas SDK 能力包含 AWS/S3、腾讯 COS、七牛与火山引擎；这些是独立后端能力，不能据依赖存在认定 FG 已配置某家云存储。依据：`production-lab/yingce/canvas/backend/go.mod`、`production-lab/yingce/canvas/backend/internal/storage/settings.go`。
- Suno 服务持有 Playwright、axios、Pino 和 captcha 相关依赖；当前调用 adapter 为自有 `CurrentSunoAPI`，不是通用官方 Suno SDK。依据：`production-lab/suno/package.json`、`production-lab/suno/server.ts`、`production-lab/suno/current-api.mjs`。

## Configuration

**Environment:**
- 本图仅检查 example env 的变量名称与源码引用，未打开实际 `.env.local`、`.env.docker` 或独立栈私密 env；示例入口为 `.env.example`、`.env.docker.example`、`.env.creator.example`、`production-lab/suno/account.env.example`。
- 主应用核心配置涉及 `DATABASE_URL`、`SESSION_SECRET`、`SESSION_COOKIE_SECURE`、`NAS_MEDIA_PATH`、`LOCAL_MEDIA_URL`、`PROVIDER_MEDIA_URL`；NAS 模式与就绪/禁用标记另由 `NAS_STORAGE_MODE`、`NAS_READY_FILE`、`NAS_DISABLED_FILE` 控制。依据：`.env.example`、`lib/local/auth.ts`、`lib/local/storage.ts`、`docker-compose.yml`。
- 模型侧区分 `WETOKEN_API_KEY`/`WETOKEN_BASE_URL`/`WETOKEN_ASSET_BASE_URL`、`DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` 和 `VOLCENGINE_SEED_AUDIO_API_KEY`；不是单一 `OPENAI_API_KEY` 契约。依据：`.env.example`、`lib/ai/wetoken-client.ts`、`lib/deepseek.ts`、`app/api/creator/audio/route.ts`。
- 旧 Next Production Lab 使用 `PRODUCTION_LAB_DATABASE_URL`、`PRODUCTION_LAB_TEXT_MODELS`、`PRODUCTION_LAB_ENABLED`；其独立库约束不同于新 Yingce gateway 的 `DATABASE_URL`。依据：`lib/production-lab/store.ts`、`lib/production-lab/text-models.ts`、`lib/production-lab/access.ts`、`production-lab/yingce/compose.yml`。
- Support Bot、观测、Tunnel 与独立栈有各自 secret/config 命名空间；按集成边界配置，不把所有可选变量视为启动必填。依据：`.env.docker.example`、`lib/support-bot/environment.ts`、`lib/observability/internal-auth.ts`、`production-lab/yingce/compose.yml`。

**Build:**
- 根构建配置为 `next.config.mjs`、`tsconfig.json`、`tailwind.config.ts`、`postcss.config.mjs`、`Dockerfile`；`APP_DEPLOYMENT_VERSION` 作为 build arg 注入镜像。依据：`Dockerfile`、`docker-compose.yml`、`lib/version.ts`。
- 主库 schema 在 `docker/initdb/`，已有库升级由 `scripts/local-db-migrate.mjs` 处理；旧 Lab 迁移单独由 `scripts/production-lab-migrate.mjs` 使用 `production-lab/migrations/`，不要混到主库启动迁移。依据：`Dockerfile`、`docker-compose.yml`、`scripts/local-db-migrate.mjs`、`scripts/production-lab-migrate.mjs`。
- 独立栈维护边界优先看 FG adapter/compose：`production-lab/yingce/gateway/`、`production-lab/yingce/compose.yml`、`production-lab/opencreator/deploy/`、`production-lab/arcreel/deploy/`、`production-lab/meilin/deploy/`、`production-lab/suno/`；各 `upstream/` 是内嵌独立源码，不应机械并入根应用依赖或全量逐文件扫描。
- ArcReel、Meilin 另有来源快照说明；来源 commit、manifest 应用版本、镜像版本和部署版本是不同概念。依据：`production-lab/arcreel/SOURCE.md`、`production-lab/meilin/SOURCE.md`、`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/yingce/gateway/runtime-version.mjs`。

## Platform Requirements

**Development:**
- 主应用应使用根 manifest 指定的 pnpm 与与 Docker 基线相容的 Node；根 manifest 未声明 `engines`，不能把容器基线当作完整开发兼容矩阵。依据：`package.json`、`Dockerfile`。
- 主业务需要 PostgreSQL，媒体读写还依赖有效本地/NAS 存储配置；只启动前端不等于账号、持久化与生成链路可用。依据：`lib/local/db.ts`、`lib/local/auth.ts`、`lib/local/storage.ts`。
- Worker 要求 Python >=3.11，凭证由 OS keyring 管理；FFmpeg/model runner 与 GPU 可用性需额外满足 capability/profile 条件。依据：`worker/pyproject.toml`、`worker/src/fg_worker/credentials.py`、`worker/src/fg_worker/runtime_config.py`、`worker/src/fg_worker/capabilities.py`。
- 独立栈分别遵守自己的 Bun/pnpm/uv/Go 版本和数据目录约束；Canvas 规则尤其禁止用 npm/pnpm 覆盖其 Bun Web 依赖环境。依据：`production-lab/yingce/canvas/AGENTS.md`、`production-lab/arcreel/upstream/AGENTS.md`、`production-lab/opencreator/upstream/package.json`。

**Production:**
- 仓库描述 macOS 宿主机、Docker Compose、NAS 与 LaunchAgent 组合；主服务仅回环映射应用端口，由 Nginx/Tunnel 提供入口。这是部署配置/记忆，不是本轮实时连通性结论。依据：`docker-compose.yml`、`docker/nginx/default.conf`、`.codex-memory/project_deployment_version.md`。
- 默认 Compose 媒体采用 offline 只读 volume；NAS overlay 将宿主机 `NAS_MEDIA_PATH` 绑定至容器 `/data/media` 并设置 nas 模式。依据：`docker-compose.yml`、`docker-compose.nas.yml`。
- 自动部署脚本进行 fast-forward、版本化构建及 `/api/version` 核对；本轮只读代码，未运行部署、容器或生产脚本。依据：`scripts/auto-deploy.sh`、`Dockerfile`、`app/api/version/route.ts`、`.codex-memory/project_deployment_version.md`。
- 已知 NAS、monitor、auto-deploy、report-scheduler、six runtime-requests/yingce 守护任务受硬性保护；本轮没有停用、重启或探测其状态。依据：`AGENTS.md`、`.codex-memory/project_deployment_version.md`。
- 旧 Creator/ArcReel 入口在 gateway 静态策略返回 410，但源码、adapter、镜像构建与 provision 代码仍保留；不能把代码存在写成生产运行，也不能把路由退役推断为进程已停。依据：`production-lab/yingce/gateway/fg-retired-modules.mjs`、`production-lab/opencreator/deploy/provision.py`、`production-lab/arcreel/deploy/provision.py`。

---

*Stack analysis: 2026-11-05*
