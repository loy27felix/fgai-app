# External Integrations

**Analysis Date:** 2026-11-05

## APIs & External Services

**主应用模型 API:**
- WeToken：文本、图片、视频与素材引用的主要代理通道；默认文本 base 为 `https://wetoken.ai/v1`，素材默认 base 为 `https://asset.wetoken.ai`。依据：`lib/ai/wetoken-client.ts`、`lib/ai/wetoken-assets.ts`。
  - SDK/Client：Node fetch + Undici dispatcher；文本走 `/chat/completions`，图片适配 generations/edits，视频按 family 适配异步任务协议，不是所有模型共享单一 OpenAI 请求形状。依据：`lib/ai/wetoken-transport.ts`、`lib/ai/wetoken-client.ts`、`lib/ai/image.ts`、`lib/ai/video.ts`。
  - Auth：`WETOKEN_API_KEY`，可配置 `WETOKEN_BASE_URL`、`WETOKEN_ASSET_BASE_URL`；部分函数可接收独立 provider 参数。依据：`.env.example`、`lib/ai/text.ts`、`lib/ai/wetoken-client.ts`。
- DeepSeek：存在独立直连 helper，默认 `https://api.deepseek.com`，使用 `/chat/completions`；不要把 helper 存在解释为所有文本请求都走直连。依据：`lib/deepseek.ts`、`lib/ai/text.ts`。
  - SDK/Client：fetch-based `deepseekChat`；Auth：`DEEPSEEK_API_KEY`，可配置 `DEEPSEEK_BASE_URL`。依据：`lib/deepseek.ts`、`.env.example`。
- 火山 Seed Audio：主应用 Creator 音频路由请求 `https://openspeech.bytedance.com/api/v3/tts/create`。依据：`app/api/creator/audio/route.ts`、`lib/ai/seed-audio.ts`。
  - SDK/Client：fetch；Auth：`VOLCENGINE_SEED_AUDIO_API_KEY` 经 `X-Api-Key` header 传递。此变量不同于新 gateway 的文件注入契约。依据：`app/api/creator/audio/route.ts`、`production-lab/yingce/gateway/fg-speech-provider.mjs`。
- Support Bot 诊断模型：支持 `chat_completions` 与 `responses` 两种协议；Responses 使用 OpenAI Node SDK，不据此推断提供商一定是 OpenAI 官方。依据：`lib/support-bot/model.ts`。
  - SDK/Client：`openai` 或现有 `chatWithTextModel`；Auth/config：`SUPPORT_BOT_API_KEY`、`SUPPORT_BOT_API_BASE_URL`、`SUPPORT_BOT_API_PROTOCOL`、`SUPPORT_BOT_MODEL_ID`、`SUPPORT_BOT_REASONING_EFFORT`。依据：`lib/support-bot/model.ts`、`lib/support-bot/diagnose.ts`、`.env.example`。

**Feishu / 客服协作:**
- Feishu Open Platform：接收消息事件、回复消息、reaction、通知模块负责人，并向 Bitable 写入/更新工单。依据：`lib/support-bot/feishu.ts`、`app/api/support-bot/events/route.ts`。
  - SDK/Client：`@larksuiteoapi/node-sdk` 的 `Client`、`AESCipher`，配合 axios transport。依据：`lib/support-bot/feishu.ts`、`package.json`。
  - Auth：`FEISHU_SUPPORT_APP_ID`、`FEISHU_SUPPORT_APP_SECRET`；事件校验使用 `FEISHU_SUPPORT_VERIFICATION_TOKEN`、可选 `FEISHU_SUPPORT_ENCRYPT_KEY`。依据：`lib/support-bot/feishu.ts`。
  - Bitable/路由配置：`FEISHU_SUPPORT_BITABLE_APP_TOKEN`、`FEISHU_SUPPORT_BITABLE_TABLE_ID`、`FEISHU_SUPPORT_BOT_OPEN_ID`、`FEISHU_SUPPORT_TENANT_KEY`、`SUPPORT_BOT_MODULE_OWNERS`。依据：`lib/support-bot/feishu.ts`、`.env.example`。
  - 开关明确区分 `SUPPORT_BOT_ENABLED`、`SUPPORT_BOT_SEND_ENABLED`；配置存在不证明已启用或已对外发送。依据：`lib/support-bot/environment.ts`、`lib/support-bot/feishu.ts`。

**第六板块 gateway / 独立运行栈:**
- 新工作台入口由 Node HTTP gateway 对接主平台身份和 Canvas 后端；该边界不是根 Next.js app 的内存内模块。依据：`production-lab/yingce/gateway/server.mjs`、`production-lab/yingce/compose.yml`。
  - SDK/Client：`node:http`、fetch、`pg`，并有 WebSocket realtime/stream 桥接。依据：`production-lab/yingce/gateway/server.mjs`、`production-lab/yingce/gateway/package.json`、`production-lab/yingce/gateway/fg-canvas-realtime.mjs`、`production-lab/yingce/gateway/fg-speech-stream.mjs`。
  - Routing/config：`FG_PLATFORM_URL`、`FG_PLATFORM_PUBLIC_URL`、`FG_SIX_PUBLIC_URL`、`FG_EXTERNAL_PUBLIC_URL`、`CANVAS_WEB_URL`，数据库使用此栈自己的 `DATABASE_URL`。依据：`production-lab/yingce/gateway/server.mjs`、`production-lab/yingce/compose.yml`。
- Yingce Agent：Compose 通过 `YINGCE_AGENT_URL` 和 `YINGCE_AGENT_TOKEN` 将 Go backend 接到独立 Node Agent；上游规则要求远端失败不得私自 fallback 到内嵌进程。依据：`production-lab/yingce/compose.yml`、`production-lab/yingce/canvas/AGENTS.md`。
- AdCraft：独立 FastAPI/Web/Agent 通过 FG gateway 的 adapter 获得模型、任务、素材与费用能力；Agent 还有 `AGENT_RUNTIME_INTERNAL_TOKEN` 服务间边界。依据：`production-lab/yingce/gateway/fg-adcraft.mjs`、`production-lab/yingce/gateway/fg-adcraft-models.mjs`、`production-lab/yingce/compose.yml`、`production-lab/adcraft/upstream/apps/api/agent/package.json`。
- Meilin：gateway 代理页面和业务 API，使用签名身份调用原生 Node 服务，媒体/生成能力回接 Canvas；Compose 中属于可选 `meilin` profile。依据：`production-lab/yingce/gateway/fg-meilin.mjs`、`production-lab/meilin/upstream/server/fg-server.mjs`、`production-lab/meilin/upstream/server/fg-context.mjs`、`production-lab/yingce/compose.yml`。
  - Auth/config：`MEILIN_INTERNAL_SECRET`、`MEILIN_MODE`、`MEILIN_GATEWAY_URL`、`MEILIN_URL`。依据：`production-lab/yingce/gateway/fg-meilin.mjs`、`production-lab/meilin/upstream/server/fg-context.mjs`、`production-lab/yingce/compose.yml`。
- OpenCreator：保留按 actor/capability 隔离的 Daemon、Codex/媒体 runtime 与 company-media adapter；FG 注入的是受限 capability，而不是提供商真实账号 key。依据：`production-lab/opencreator/deploy/entry.mjs`、`production-lab/opencreator/deploy/company-media.mjs`、`production-lab/opencreator/deploy/provision.py`。
  - Auth/config：`FG_CREATOR_ACTOR`、`FG_CREATOR_CAPABILITY`；`/internal/creator/{actor}` 为受信任桥接面。依据：`production-lab/opencreator/deploy/entry.mjs`。
- ArcReel：保留独立 FastAPI/Claude Agent SDK 栈与 company_request/company_cost adapter，模型能力通过 gateway 注入；不要直接按 upstream provider 清单推断 FG 开通了所有供应商。依据：`production-lab/arcreel/upstream/pyproject.toml`、`production-lab/arcreel/deploy/entry.py`、`production-lab/arcreel/deploy/company_request.py`、`production-lab/arcreel/deploy/company_cost.py`。
  - Auth/config：`FG_ARC_ACTOR`、`FG_ARC_CAPABILITY`、`FG_ARC_GATEWAY_URL`。依据：`production-lab/arcreel/deploy/entry.py`。
- 可达性边界：gateway 明确将旧 `/creator-app`、`/arcreel`、`/fg-director`、部分 Creator API 和 `/internal/arcreel/` 列为 retired，返回 410；源码/manifest/旧 provision 的存在不能证明入口仍开放或进程已停。依据：`production-lab/yingce/gateway/fg-retired-modules.mjs`、`production-lab/yingce/gateway/server.mjs`。

**独立音频与账单对接:**
- 新 gateway 火山语音：包含 Seed Audio、TTS、ASR 与翻译能力定义，读取容器文件 `/run/fg-secrets/volc-speech.key`；只确认代码入口，未读取该文件。依据：`production-lab/yingce/gateway/fg-speech-provider.mjs`、`production-lab/yingce/gateway/fg-speech-stream.mjs`。
- Suno 公司服务：gateway 调用内部 `http://suno:3050`，服务通过 `CurrentSunoAPI` 对接 Suno Web/auth API；其 package 中虽有浏览器/captcha 依赖，也不能据此假定当前使用自动验证码或供应商官方 SDK。依据：`production-lab/yingce/gateway/fg-music-provider.mjs`、`production-lab/suno/server.ts`、`production-lab/suno/current-api.mjs`、`production-lab/suno/package.json`。
  - Auth：服务端 Bearer `SUNO_SERVICE_SECRET`；gateway 使用 `FG_ADCRAFT_SECRET` 派生内部授权。账号配置名称为 `SUNO_COOKIE`、`TWOCAPTCHA_KEY`、`SUNO_MODEL`、`SUNO_ENABLED`。依据：`production-lab/yingce/gateway/fg-music-provider.mjs`、`production-lab/suno/server.ts`、`production-lab/suno/account.env.example`。
- WeToken 费用：主应用有 CSV/Reference ID 对账与 ledger 代码，新 gateway 另有 fee-sync/授权管理；不是按模型名或时间相近就能确认账单匹配。依据：`lib/usage/wetoken-fee-reconciliation.ts`、`lib/usage/wetoken-fee-attribution.ts`、`lib/usage/ledger.ts`、`production-lab/yingce/gateway/fg-fee-sync.mjs`。
  - 授权配置：`WETOKEN_FEE_SESSION_FILE`、`FG_FEE_SYNC_ACTOR_ID`；数据库授权封装使用 AES-256-GCM，secret 来源为 `FG_BILLING_SECRET` 或 `FG_ADCRAFT_SECRET`。未检查实际授权内容/有效性。依据：`production-lab/yingce/gateway/fg-fee-auth.mjs`、`production-lab/yingce/gateway/fg-fee-sync.mjs`。

## Data Storage

**Databases:**
- 主业务为 PostgreSQL；Compose 声明 16-alpine，用户、会话、创作任务、usage、observability 与 Support Bot schema 均有本地 SQL。依据：`docker-compose.yml`、`docker/initdb/001-local.sql`、`docker/initdb/003-local-observability.sql`、`docker/initdb/013-local-media-workers.sql`、`docker/initdb/016-support-bot.sql`。
  - Connection：`DATABASE_URL`；Client：`pg.Pool` 和自有 `LocalQuery`/client abstraction，不应把近似 Supabase 的调用外形解释为仍使用托管 Supabase。依据：`lib/local/db.ts`、`lib/local/client.ts`、`lib/local/server.ts`。
  - Schema：首次初始化与已有库升级分离，应用启动先执行 migration script；不能据文件存在宣称生产已迁移至最新。依据：`docker-compose.yml`、`scripts/local-db-migrate.mjs`、`docker/initdb/`。
- 旧 Next Production Lab 使用独立 PostgreSQL 库保存 JSON state、剧本、画布、媒体队列和小组记账；拒绝与主库使用相同 host/port/database identity。依据：`lib/production-lab/store.ts`、`production-lab/migrations/`、`scripts/production-lab-migrate.mjs`。
  - Connection：`PRODUCTION_LAB_DATABASE_URL`；Client：独立 `pg.Pool`，state 更新使用事务/行锁/revision。依据：`lib/production-lab/store.ts`。
- 新 Yingce 栈 Compose 声明 PostgreSQL 17；gateway 直接写 Canvas 用户、会话、FG accounts 等表，Go backend 使用 GORM。它不是旧 Lab 独立库的别名。依据：`production-lab/yingce/compose.yml`、`production-lab/yingce/gateway/server.mjs`、`production-lab/yingce/canvas/backend/internal/database/database.go`。
- AdCraft 使用 SQLAlchemy + SQLite；FG 模式按运行配置确定隔离 DB 根，并由 Compose 挂载专用 database volume。依据：`production-lab/adcraft/upstream/apps/api/app/persistence/database.py`、`production-lab/yingce/compose.yml`。
- Meilin 使用 `DATABASE_URL` + `pg.Pool`，初始化读取自身 `schema.sql`；不要把它的演示状态目录当作 FG 正式持久化。依据：`production-lab/meilin/upstream/server/fg-store.mjs`、`production-lab/meilin/upstream/schema.sql`。
- OpenCreator 与 ArcReel 的 retained provisioning 分别处理私有 SQLite `app.sqlite`、`arcreel.db` 及备份；这是脚本约定，不是当前磁盘/实例检查。依据：`production-lab/opencreator/deploy/provision.py`、`production-lab/arcreel/deploy/provision.py`。

**File Storage:**
- 主应用媒体保存到本地/NAS 文件系统，不是直接连接 S3 的根应用存储 SDK；bucket/path 经安全路径检查，再生成公开或带过期签名的访问 URL。依据：`lib/local/storage.ts`。
- NAS 配置：`NAS_MEDIA_PATH`、`NAS_STORAGE_MODE`、`NAS_READY_FILE`、`NAS_DISABLED_FILE`；默认 offline 模式与 NAS overlay 分开，禁止因为目录存在就推断 NAS 就绪。依据：`lib/local/storage.ts`、`docker-compose.yml`、`docker-compose.nas.yml`。
- 浏览器/供应商 URL 分别由 `LOCAL_MEDIA_URL`、`PROVIDER_MEDIA_URL` 控制，签名校验依赖 `SESSION_SECRET`；服务端内部媒体请求另可配置 `LOCAL_MEDIA_INTERNAL_URL`。依据：`lib/local/storage.ts`、`lib/local/media-url.ts`。
- Worker 输出通过服务端 init/chunk/complete 上传协议落入受控存储；不是给 Worker 直接共享 PostgreSQL 或 NAS 凭证。依据：`worker/src/fg_worker/client.py`、`worker/src/fg_worker/queue_loop.py`、`lib/local/worker-storage.ts`、`app/api/creator/worker/uploads/[id]/complete/route.ts`。
- 新栈将 NAS 分别挂到 Canvas/AdCraft/Meilin 的容器路径；Canvas 自身另提供 S3、腾讯、七牛、阿里兼容配置，未确认实际启用哪种外部 object storage。依据：`production-lab/yingce/compose.yml`、`production-lab/yingce/canvas/backend/internal/storage/settings.go`、`production-lab/yingce/canvas/backend/internal/storage/s3.go`。
- Suno 声明 `/state` 命名 volume；Meilin files/skills、旧用户 runtime 的 workspace/state 分属各自挂载契约。依据：`production-lab/suno/compose.yml`、`production-lab/suno/server.ts`、`production-lab/yingce/compose.yml`、`production-lab/opencreator/deploy/provision.py`、`production-lab/arcreel/deploy/provision.py`。

**Caching:**
- 主浏览器持久化使用 localForage，失败时 fallback 至 localStorage，并为 Zustand 提供 `StateStorage`；它不是服务端 Redis。依据：`lib/localforage-storage.ts`。
- 新 Canvas 栈声明 Redis 7.4 与 `REDIS_URL`，主应用 Compose 未声明 Redis 服务；不能写成全仓统一 Redis 缓存。依据：`production-lab/yingce/compose.yml`、`docker-compose.yml`。
- gateway 使用进程内 Map 缓存生成的 Canvas session，并有 PostgreSQL 持久会话；内存缓存不替代平台每次请求的身份校验。依据：`production-lab/yingce/gateway/server.mjs`。

## Authentication & Identity

**Auth Provider:**
- 主应用采用自建邮箱/密码认证，密码使用 Node crypto `scrypt` + salt + timing-safe compare，账号与 session 存在 PostgreSQL。依据：`lib/local/auth.ts`、`lib/local/password.ts`、`docker/initdb/001-local.sql`。
  - Implementation：随机 session ID，30 天有效期，Cookie 名为 `fg_session`，HttpOnly；production Secure 行为受 `SESSION_COOKIE_SECURE` 控制。`SESSION_SECRET` 不应误写成此 opaque session 的 JWT signing key。依据：`lib/local/auth.ts`、`lib/local/storage.ts`。
- middleware 先检查 Cookie 是否存在并执行导航门禁；真实用户/过期校验在服务端会话查询中完成，不能将 Cookie presence 当作完整认证。依据：`lib/local/middleware.ts`、`lib/local/auth.ts`。
- 旧 Lab 门禁是主平台角色 + `PRODUCTION_LAB_ENABLED`；新 gateway 公司成员访问与管理员权限另行判定，不能照搬旧 README 的“仅超级管理员”覆盖所有新入口。依据：`lib/production-lab/access.ts`、`production-lab/yingce/gateway/server.mjs`、`production-lab/README.md`。
- gateway 每次请求拿 `fg_session` 调主平台 `/api/auth/session`，再同步 Canvas identity/role，并生成 `open_ai_canvas_session`；原生会话 token hash 存入 Canvas `auth_sessions`。依据：`production-lab/yingce/gateway/server.mjs`。
- 服务间身份不是同一套浏览器 Cookie：AdCraft/Creator 使用 FG secret/capability，Meilin 使用签名 identity，Yingce Agent 使用独立 token。依据：`production-lab/yingce/gateway/fg-adcraft.mjs`、`production-lab/yingce/gateway/fg-creator.mjs`、`production-lab/yingce/gateway/fg-meilin.mjs`、`production-lab/yingce/compose.yml`。
- 媒体 Worker 通过 pairing code 注册，持有 Bearer worker token，并在 job 操作中附加 lease token；客户端 token 保存至 OS keyring。该 API 契约未经过本轮端到端路由验证。依据：`lib/creator/media-worker-auth.ts`、`worker/src/fg_worker/credentials.py`、`worker/src/fg_worker/client.py`、`middleware.ts`。
- Feishu webhook 与 Support Bot processor 使用独立鉴权，观测内部入口使用 `x-fg-observability-secret`，native support 使用 read token；不要把这些入口的 middleware 放行解释为无鉴权。依据：`lib/local/middleware.ts`、`lib/support-bot/feishu.ts`、`app/api/support-bot/process/route.ts`、`lib/observability/internal-auth.ts`、`production-lab/yingce/gateway/fg-support-native.mjs`。

## Monitoring & Observability

**Error Tracking:**
- 已确认的是自建客户端错误、provider exchange、request/audit 与数据库日志链路；根 manifest 未声明 Sentry 等专用错误追踪 SDK，未核实外部平台接入。依据：`package.json`、`app/layout.tsx`、`lib/observability/server-log.ts`、`lib/observability/server-log-persistence.ts`、`lib/observability/audit-event.ts`。
- 浏览器上报入口包括 `/api/observability/client-errors`、`client-exchanges`；内部 monitor/error/request events 使用专用 secret 校验，取 `FG_OBSERVABILITY_SECRET`，代码另有 `SESSION_SECRET` fallback。依据：`lib/local/middleware.ts`、`app/api/observability/`、`lib/observability/internal-auth.ts`。
- Support Bot 可查询主库、Canvas 库、旧 Lab 库与 native gateway，并配置各服务 version probe；这是诊断能力，不代表已成功连接。依据：`lib/support-bot/canvas-logs.ts`、`lib/support-bot/production-operations.ts`、`lib/support-bot/product-native.ts`、`.env.example`。

**Logs:**
- middleware 传播 trace/request 信息；Node 服务日志脱敏后批量持久化 PostgreSQL，provider 请求另有关联字段。依据：`middleware.ts`、`lib/observability/server-log-edge.ts`、`lib/observability/server-log-persistence.ts`、`lib/ai/wetoken-client.ts`。
- Docker logging、宿主日志归档与 monitor/outbox 相互补充；告警 webhook 由 `FG_MONITOR_WEBHOOK_URL`、`FG_MONITOR_WEBHOOK_TYPE` 配置，支持 Feishu/generic 分支。依据：`docker-compose.yml`、`scripts/app-log-archive.sh`、`scripts/service-monitor.sh`、`scripts/observability-outbox.sh`。
- 报表聚合持久化至 report schema；example env 提供 `FG_REPORT_WEBHOOK_URL`/`FG_REPORT_WEBHOOK_TYPE`，但本轮未确认实际调度器加载或通知投递状态。依据：`lib/observability/reporting.ts`、`docker/initdb/005-observability-reporting.sql`、`.env.docker.example`、`AGENTS.md`。
- 新栈有 gateway support correlation/native evidence、host metrics，以及 Suno 自身日志实现；这些不等于已有统一 SaaS observability。依据：`production-lab/yingce/gateway/support-observability.mjs`、`production-lab/yingce/gateway/fg-support-native.mjs`、`production-lab/yingce/collect-host-metrics.py`、`production-lab/suno/support-log.mjs`。

## CI/CD & Deployment

**Hosting:**
- 主应用为 Docker standalone Next.js + PostgreSQL，Nginx 可选 HTTPS，Cloudflare Tunnel 提供隧道入口；Tunnel token 从 `CLOUDFLARE_TUNNEL_TOKEN` 注入。依据：`Dockerfile`、`docker-compose.yml`、`docker/nginx/default.conf`。
- macOS/NAS/LaunchAgent 是仓库记忆和维护脚本描述的生产宿主形态；本轮未 SSH、未查询容器或守护任务。依据：`.codex-memory/project_deployment_version.md`、`AGENTS.md`、`scripts/nas-supervisor.sh`、`scripts/install-auto-deploy.sh`。
- 新栈有单独的 `production-lab/yingce/compose.yml` 和 `compose.support-host.yml`，涉及 backend/agent/web/gateway/TLS、独立 DB/Redis 和私密只读诊断入口；不要与根 Compose 视作同一部署单元。依据：`production-lab/yingce/compose.yml`、`production-lab/yingce/compose.support-host.yml`。
- 旧 Creator/ArcReel 另有 per-user provision 与私有状态卷设计，脚本存在不证明当前仍有实例。依据：`production-lab/opencreator/deploy/provision.py`、`production-lab/arcreel/deploy/provision.py`、`production-lab/arcreel/deploy/runtime-requests.plist`。

**CI Pipeline:**
- 未在根仓库发现受跟踪的 `.github` workflow；已确认的是本地脚本化部署/测试入口，不能据此断言外部 CI 不存在。依据：`package.json`、`scripts/auto-deploy.sh`。
- 自动部署读取 Git 新提交后 fast-forward，并按最新脚本继续执行，构建显式传递 `APP_DEPLOYMENT_VERSION`，健康验证包含 `/api/version` 中的部署版本。依据：`scripts/auto-deploy.sh`、`Dockerfile`、`app/api/version/route.ts`、`.codex-memory/project_deployment_version.md`。
- 所有生产守护任务不得为审计/映射主动停用或重启；本轮未运行上述脚本，也未构建、测试或安装依赖。依据：`AGENTS.md`。

## Environment Configuration

**Required env vars:**
- 主库/会话/媒体：`DATABASE_URL`、`SESSION_SECRET`、`SESSION_COOKIE_SECURE`、`NAS_MEDIA_PATH`、`LOCAL_MEDIA_URL`、`PROVIDER_MEDIA_URL`；NAS runtime 另使用 `NAS_STORAGE_MODE`、`NAS_READY_FILE`、`NAS_DISABLED_FILE`。按运行模式配置。依据：`.env.example`、`lib/local/storage.ts`、`lib/local/auth.ts`。
- Compose 基础设施：`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`CLOUDFLARE_TUNNEL_TOKEN`；HTTPS profile 另涉及 `FG_NGINX_CERT_PATH`、`FG_NGINX_KEY_PATH`。依据：`.env.docker.example`、`docker-compose.yml`。
- 模型按需配置：`WETOKEN_API_KEY`/`WETOKEN_BASE_URL`/`WETOKEN_ASSET_BASE_URL`、`DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`、`VOLCENGINE_SEED_AUDIO_API_KEY`。未调用对应 provider 时不能统称全部启动必填。依据：`.env.example`、`lib/ai/wetoken-client.ts`、`lib/deepseek.ts`、`app/api/creator/audio/route.ts`。
- 旧 Lab：`PRODUCTION_LAB_ENABLED`、`PRODUCTION_LAB_DATABASE_URL`、`PRODUCTION_LAB_TEXT_MODELS`；媒体 Worker：`MEDIA_WORKER_ENABLED`、`FG_WORKER_RELEASE_MANIFEST_PATH`，客户端安装/目录配置还有 `FG_STUDIO_SERVER_URL`、`FG_WORKER_HOME`、`FG_WORKER_FFMPEG_DIR`。依据：`lib/production-lab/access.ts`、`lib/production-lab/store.ts`、`lib/production-lab/text-models.ts`、`.env.example`、`worker/src/fg_worker/installer.py`、`worker/src/fg_worker/runtime_config.py`。
- 新栈：镜像变量 `CANVAS_BACKEND_IMAGE`、`CANVAS_AGENT_IMAGE`、`CANVAS_WEB_IMAGE`、`ADCRAFT_API_IMAGE`、`ADCRAFT_AGENT_IMAGE`、`ADCRAFT_WEB_IMAGE`；运行契约包含 `DATABASE_URL`、`REDIS_URL`、`YINGCE_AGENT_TOKEN`、`FG_ADCRAFT_SECRET`、NAS 与 TLS 路径。依据：`production-lab/yingce/compose.yml`。
- 观测/诊断：`FG_OBSERVABILITY_SECRET`、`FG_OBSERVABILITY_URL`、`SUPPORT_BOT_WORKER_TOKEN`、`SUPPORT_BOT_ENVIRONMENT`、`SUPPORT_BOT_ENABLED`、`SUPPORT_BOT_SEND_ENABLED`、`SUPPORT_BOT_CANVAS_DATABASE_URL`、`SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL`、`SUPPORT_BOT_NATIVE_GATEWAY_URL`、`SUPPORT_BOT_NATIVE_READ_TOKEN`；其他 version/log source 开关见 example。依据：`.env.example`、`.env.docker.example`、`lib/support-bot/environment.ts`、`lib/support-bot/product-native.ts`。
- 此表按边界列关键名称，不是全变量清单；有效值、是否部署/授权、供应商连通性和容器实际镜像均未核验。依据范围：`.env.example`、`.env.docker.example`、`production-lab/yingce/compose.yml`。

**Secrets location:**
- 根应用/Compose 读取本地 env 或容器 environment；仅列 `.env.local`、`.env.docker` 的配置位置，不读取、不复制真实内容。Compose 的 env_file 契约见 `docker-compose.yml`，可公开格式见 `.env.example`、`.env.docker.example`。
- Worker token 在操作系统 keyring 中，job lease 随请求传输；不在本图记录配对码、worker token 或下载签名。依据：`worker/src/fg_worker/credentials.py`、`worker/src/fg_worker/client.py`。
- 新语音使用 `/run/fg-secrets/volc-speech.key`；fee-sync 可读取授权文件或数据库密文；只映射代码中的路径/名称，没有读取文件或数据库记录。依据：`production-lab/yingce/gateway/fg-speech-provider.mjs`、`production-lab/yingce/gateway/fg-fee-auth.mjs`。
- Suno 账号环境、runtime capability、Meilin/internal tokens 分属独立服务边界；受限 capability 不应替换为根提供商账号密钥。依据：`production-lab/suno/account.env.example`、`production-lab/suno/compose.yml`、`production-lab/opencreator/deploy/entry.mjs`、`production-lab/arcreel/deploy/entry.py`、`production-lab/yingce/compose.yml`。

## Webhooks & Callbacks

**Incoming:**
- `POST /api/support-bot/events`：Feishu URL verification 与消息事件入口，验证 token/可选加密签名后进入本地队列。依据：`app/api/support-bot/events/route.ts`、`lib/support-bot/feishu.ts`、`lib/support-bot/store.ts`。
- `POST /api/support-bot/process`：由 `SUPPORT_BOT_WORKER_TOKEN` 验证的任务处理入口，不是公开供应商 callback。依据：`app/api/support-bot/process/route.ts`、`lib/support-bot/feishu.ts`。
- `/api/observability/monitor-events`、`error-events`、`request-events`：监测/部署/Edge 事件上报入口；另有浏览器 client-errors/client-exchanges。依据：`app/api/observability/`、`lib/observability/internal-auth.ts`、`scripts/observability-outbox.sh`。
- `/api/creator/worker/register`、`heartbeat`、`jobs/*`、`uploads/*`：Worker 主动拉取/心跳/回传的 API，不是向 Worker 推送公网 webhook；当前入口守卫阻断独立客户端的风险见 `.planning/codebase/CONCERNS.md`。依据：`worker/src/fg_worker/client.py`、`app/api/creator/worker/`。
- gateway `/internal/creator/*`、AdCraft/Meilin 内部路由和 native support 路由为受信任服务接口；ArcReel 旧 internal 前缀已列 retired。依据：`production-lab/yingce/gateway/fg-creator.mjs`、`production-lab/yingce/gateway/fg-adcraft.mjs`、`production-lab/yingce/gateway/fg-meilin.mjs`、`production-lab/yingce/gateway/fg-support-native.mjs`、`production-lab/yingce/gateway/fg-retired-modules.mjs`。

**Outgoing:**
- Feishu 消息、reaction、负责人通知及 Bitable 操作为主动 SDK API 请求，不是独立入站回调。依据：`lib/support-bot/feishu.ts`。
- `FG_MONITOR_WEBHOOK_URL` 接收健康告警；`FG_MONITOR_WEBHOOK_TYPE` 选择 payload；是否配置和成功投递未验证。依据：`scripts/service-monitor.sh`、`.env.docker.example`。
- 图片/视频/语音对供应商发起 HTTP 请求；视频存在主动状态查询/恢复路径，不把异步任务机制写成已配置供应商 webhook。依据：`lib/ai/video.ts`、`lib/creator/video-task-reconciliation.ts`、`lib/creator/video-recovery.ts`、`app/api/creator/audio/route.ts`。
- 供应商参考媒体通过 `PROVIDER_MEDIA_URL` 的签名链接读取本地/NAS 资源；这是资源访问面，不是任务完成 callback。依据：`lib/local/storage.ts`、`lib/ai/wetoken-assets.ts`。

---

*Integration audit: 2026-11-05*
