---
phase: main-site-retirement
plan: "01"
type: execute
wave: 1
depends_on: []
autonomous: false
files_modified:
  - production-lab/meilin/README.md
  - production-lab/meilin/canvas/Dockerfile
  - production-lab/meilin/canvas/backend/internal/auth/auth.go
  - production-lab/meilin/canvas/backend/internal/auth/password_fg.go
  - production-lab/meilin/canvas/docs/content/docs/backend/code-map.mdx
  - production-lab/meilin/canvas/docs/content/docs/backend/fg-workspace-privacy.mdx
  - production-lab/meilin/canvas/docs/content/docs/backend/http-api.mdx
  - production-lab/meilin/canvas/docs/content/docs/overview/features.mdx
  - production-lab/meilin/canvas/docs/content/docs/progress/pending-test.mdx
  - production-lab/meilin/canvas/docs/design/sms-channels-and-auth-policy.md
  - production-lab/meilin/canvas/web/src/components/auth/fg-session-recovery.tsx
  - production-lab/meilin/canvas/web/src/components/auth/require-auth.tsx
  - production-lab/meilin/canvas/web/src/components/feedback/support-assistant-button.tsx
  - production-lab/meilin/canvas/web/src/lib/fg-entry-url.ts
  - production-lab/meilin/canvas/web/src/pages/auth/forgot-password.tsx
  - production-lab/meilin/canvas/web/src/pages/auth/login.tsx
  - production-lab/meilin/canvas/web/src/pages/auth/register.tsx
  - production-lab/meilin/canvas/web/src/pages/settings/index.tsx
  - production-lab/meilin/canvas/web/src/pages/settings/profile-pane.tsx
  - production-lab/meilin/canvas/web/src/router.tsx
  - production-lab/meilin/canvas/web/src/services/api/auth.ts
  - production-lab/meilin/canvas/web/src/services/api/support-assistant.ts
  - production-lab/meilin/canvas/web/src/vite-env.d.ts
  - production-lab/meilin/compose.standalone.yml
  - production-lab/meilin/compose.yml
  - production-lab/meilin/gateway/fg-auth.mjs
  - production-lab/meilin/gateway/fg-canvas-realtime.mjs
  - production-lab/meilin/gateway/fg-creator.mjs
  - production-lab/meilin/gateway/fg-team-stories.mjs
  - production-lab/meilin/gateway/migrate-platform-accounts.mjs
  - production-lab/meilin/gateway/policy.mjs
  - production-lab/meilin/gateway/server.mjs
  - scripts/auto-deploy.sh
  - scripts/nas-supervisor.sh
  - scripts/observability-outbox.sh
  - scripts/service-monitor.sh
user_setup: []
must_haves:
  truths:
    - 本地 standalone 明确选择 native auth，认证和团队目录均不请求旧 Next；旧编排默认行为不变。
    - 原用户 UUID、角色和禁用状态不变；不清空密码，不重建用户，不覆盖既有项目与成员关系。
    - 费用、原生媒体与请求观测不被误判为必须迁移的 Next 功能。
    - 未迁移的 Support Bot、历史媒体和旧 groups 明示边界，不冒充全量迁移完成。
    - 本地代码交付与生产流量切换、旧进程退役分别验收；后两者未授权。
  artifacts:
    - path: production-lab/meilin/compose.standalone.yml
      provides: 显式 native 模式、复用 Yingce 服务的本地候选编排，不包含 Next app。
    - path: production-lab/meilin/gateway/fg-team-stories.mjs
      provides: native 模式只从本地 native users 同步目录，保留既有小组和成员关系。
    - path: production-lab/meilin/README.md
      provides: 本地候选运行边界、保留数据、已知缺口和生产 checkpoint。
  key_links:
    - standalone gateway -> existing Go auth/session -> original UUID
    - native users -> fg_accounts -> existing fg_groups/fg_memberships
    - TLS entry -> gateway -> native web/backend, not Next
    - gateway fee sync -> WeToken; native resources -> Canvas storage
---

<objective>
退役旧 Next.js 主站的本地运行依赖，使现有 Yingce 工作台具备唯一入口的候选代码与编排；保留旧配置默认值以免本地合入改变生产。
本文件为按用户限制合并在一个 PLAN.md 的执行容器，内含三项任务及其 waves，不再拆分计划、生成 SUMMARY 或测试文件。
本地代码与验证结果见 .planning/STATE.md；剩余数据/能力缺口和生产操作由 P1 单独约束，不能把候选代码存在当作完整退役。
</objective>

<context>
@AGENTS.md
@.codex-memory/MEMORY.md
@.codex-memory/project_deployment_version.md
@.planning/STATE.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/INTEGRATIONS.md
@.planning/codebase/CONCERNS.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/TESTING.md
@production-lab/meilin/canvas/AGENTS.md
</context>

## 授权与执行硬边界

- 用户先授权本地实施，随后明确要求启动项目并实际测试；本轮允许新建本地隔离测试库和运行 native 服务，不含部署、SSH、生产命令、生产探测、切流、停用、重载或强制重启。
- 禁止连接生产数据库执行 DDL、迁移、账号/groups 导入、批量 URL 更新、清表或清理历史数据；不得删除/移动 NAS 文件或既有 Docker volumes。2026-11-06 用户明确要求只处理本地数据库，允许只读读取本地旧站用户并迁入当前本地 native 库；不包含 SSH、生产访问、修改旧库或迁移其他历史业务数据。
- Gateway/backend 启动会建表、回填授权、写队列，不能当作只读检查；本轮实际启动只连接本轮测试容器与本地空目录。仍不运行 support worker、preflight、auto-deploy、service-monitor、nas-supervisor 或安装器，不操作生产服务。
- 不停用任何生产任务，尤其根 AGENTS.md 列出的六个 LaunchAgent。禁止 stop/kill/disable、卸载 plist、删除锁、强制 kickstart；不得通过脚本间接做这些操作。
- 不新增依赖，不改 lockfile，不新增或生成测试文件，不自动 commit/push/rebase/reset，不改无关源码或 vendor。
- 主进程拥有 Gateway auth 与 native 团队同步；backendworker 拥有账号 import/密码兼容。不要重复实现或覆盖其修改；同一 server.mjs 的后续集成必须顺序执行。

## 已确认依赖与证据（静态源码，不是在线状态）

| 范围 | 确定事实与确切位置 | 最小处理 / 未确认边界 |
| --- | --- | --- |
| 登录 | platform 模式的 `platformActor()` 逐请求访问旧 session；`gateway/policy.mjs` 封锁 managedAuth | 已交付显式 native 分支，改用既有 Go auth；默认 platform 保留，不另起认证服务。 |
| 团队/项目入口 | platform 的 `refreshAccounts()` / `bootstrapTeam()` 访问 `/api/production-lab/admin`；由 projects GET 与 team API 触发 | 已交付 native users → fg_accounts 本地同步；现存 fg_groups/fg_memberships 不变，不代表旧 groups 已迁入。 |
| 网页 Support Bot | `canvas/web/src/components/layout/workspace-top-bar.tsx` 挂载 SupportAssistantButton；`services/api/support-assistant.ts` 请求 `/api/support-bot/web`（轮询/POST/SSE）；截图同路径。真正 handler 在 `app/api/support-bot/web/route.ts`，使用 Next 会话 | 确定客户端依赖旧 API 契约，但不能据此认定当前 `/fg-six/` 已正确代理：根 Nginx 默认路径到 Next，Yingce TLS→gateway→web 的 `/api/` 则进 Go。不能用 native session 直接调用旧 handler。 |
| 飞书/队列 | `app/api/support-bot/events/route.ts`、`process/route.ts`、`scripts/support-bot-worker.ts`、`lib/support-bot/` 依赖旧运行时与库；`.env.example` 的 ENABLED/SEND_ENABLED 都为 false | 仅配置示例，不是运行开关；本轮没读生产 env/队列/回调配置，实际启用未确认。不要为未知能力迁移整套机器人。 |
| 请求观测 | `gateway/support-observability.mjs` 输出结构化 stdout、传 request/trace ID，无 Next HTTP 调用 | 保留，不迁移；native 认证成功后仍需赋可信 userId，不能信任客户端用户 header。 |
| 运维观测 | `scripts/service-monitor.sh`、`auto-deploy.sh`、`observability-outbox.sh` 上报旧 `/api/observability/{monitor-events,error-events}`；handler 位于 `app/api/observability/` | 确认脚本调用依赖，不代表所有上报当前成功。standalone 必须保留本地日志/outbox，不能假 2xx 消费队列或把 payload 丢给 Go 通用 API。 |
| 费用 | `gateway/fg-fee-sync.mjs` 直连 WeToken fee-log；`fg-fee-usage.mjs`、`fg-fee-auth.mjs` 和原生扩展表实现对账/凭据读取 | 未发现这条链调用旧 usage API。保留现有账本/凭据卷；actorId/授权实际是否配置未确认，不运行真实扣费或对账。 |
| 原生媒体 | Gateway publicResourceRead/publicCanvasShareRead → web → Go；`fg-share-existing.mjs` 启动会给已有原生故事素材回填 grants | 不应删改或重写这条数据路径；因此不能启动 server 当作只读检查。 |
| 历史媒体 URL | `lib/local/storage.ts` 默认生成 `/api/local/storage/content`，对应 Next handler；另有 `app/api/production-lab/assets/[id]/content/route.ts` | 证明旧 URL 能力存在，未证明现存 Yingce 数据包含这些 URL。未读取 DB/NAS，不能声称“全部媒体无需 Next”或擅自全仓/全库替换 URL。 |
| 版本 | `app/api/version/route.ts` 返回旧 systemVersion/requiredSystemVersion/deploymentVersion；auto-deploy 与 service-monitor 依赖它。Gateway `runtime-version.mjs`、web Vite runtime manifest 已独立 | native 应按实际 runtime 元数据核对，不把网关版本冒充旧主站版本，也不能只改健康 URL 而遗漏 payload 校验。 |
| 入口与编排 | `docker/nginx/default.conf` 的 `location /` → app；`docker-compose.yml` 的 nginx depends_on app。Yingce `compose.yml` 固定 FG_PLATFORM_URL，加入 external fg-studio 网络；`tls.conf` 全路径到 gateway | 新增 opt-in standalone overlay，不修改旧默认入口、不把“有 standalone 文件”当生产切流完成。网络本身不是 Next 服务，不擅自删除共享网络。 |
| 守护/自动恢复 | `scripts/nas-supervisor.sh` 会启动/重建旧 app；auto-deploy 构建/重建 app；monitor 探测 app 与 `/api/version` | 只更新本地候选分支且默认维持 legacy；生产需先改下一轮目标并确认不复活旧 app，绝不能以停守护进程规避。 |
| 报表/其他服务 | 记忆确认 report-scheduler 受保护；仓内有 `lib/observability/reporting.ts`，但本轮未定位完整调度入口；Meilin 是可选 profile，retired modules 的源码仍在 | 未确认调度当前调用、启用 profile、历史离线任务依赖；不能伪称已迁移报表，不能为这些未知项重构全仓/所有 upstream。 |

## Support Bot 保留能力的最小迁移边界（主进程决策依据）

- 没有 `lib/support-bot/web.ts`。现有可复用 core 为 `store.ts`（入队/取消）、`web-stream.ts`（owner 隔离读取、标准 Response/SSE）、`context.ts`、`runtime.ts`、`environment.ts`，以及 `worker.ts` 的诊断/回复链。静态递归 import 审计未发现这些 core 可达 `next/headers`（不是运行打包验证）。
- 确认的 Next 链：`app/api/support-bot/web/route.ts → lib/local/server.ts → lib/local/server-client.ts → next/headers`；`server-client.ts → lib/local/auth.ts → next/headers`。另一个框架耦合是 route 的 `NextResponse`，不是 core。`web-stream.ts` 自己返回标准 `Response`，可继续用，但 Node HTTP adapter 必须转接流取消/背压、SSE 禁缓存/禁缓冲。
- 因此不是“换 auth adapter 就完成”：完整保留路径需要框架无关 GET/POST handler、可信 native 身份、受保护 HTTP adapter 和既有 worker，不能直接 import 当前 route。本轮只交付 native 不可用的可见边界，不迁整套机器人；是否保留网页/飞书等实际能力、数据源与运行包装在 P1 前逐项确认。
- 数据依赖仍在：core 的 `lib/local/db.ts` 读取支持队列所在旧 FG 数据库（不是 HTTP 依赖，不等于必须保留 Next 进程）；`environment.ts` 校验 DATABASE_URL、本地回环与数据库级 fg.support_environment 标记，不能直接把 DATABASE_URL 改成 Canvas 库后期望队列可用。`ensureSupportSchema()` 实际只 SELECT 必需列，不替代安装/迁移 schema，不能因函数名误判它会建表。
- 完整回复需要已有 `scripts/support-bot-worker.ts → lib/support-bot/worker.ts → diagnose/model/tools`；worker 入口用 `@next/env` 加载环境，不是 next/headers/Next HTTP 服务，可复用既有依赖或显式环境，但不得误加载生产 env。还需要模型配置、只读诊断 DB/runtime 源及原有队列租约/取消语义。只有 API 入队而没有 worker 回复，不算保留成功。
- `captureSupportRuntime()/resolveSupportRuntime()` 仍采用 APP_DEPLOYMENT_VERSION 与旧部署格式核验；拆离 Next 后必须注入真实 Support 运行版本、保留环境/commit 一致性检查，不能随意伪装成 Gateway 的版本。现有 Gateway 镜像只复制 gateway 文件/生产依赖；根 TS core、`@/` alias 与已有 tsx 不能假定在镜像内可导入。主进程需选择复用既有 Node/tsx 打包入口或独立 Support 运行包装，不新增认证服务/依赖，不为此重构所有 core。
- 保留验收必须覆盖 owner/跨用户拒绝、POST→持久队列→worker→GET/SSE 回复、截图、取消与幂等；飞书 SEND 开关独立，local 必须 false。当前禁止真实业务 DB 写入，动态验收只能在另获允许的隔离副本上进行，且本轮不新增测试文件。
- T2 下述 503 路径只是一项可交付的本地候选安全边界，绝不等于 Support 保留或整体退役完成；没有上述适配/包装/队列闭环，Support 继续作为 P1 阻塞。不能未经明确决定，把这项暂不可用变成永久退役。

## Waves 与责任

| Wave | Task | 需要 | 交付 / 并行约束 |
| --- | --- | --- | --- |
| 1 | T1 身份与数据边界 | 本地代码/fixture 已验收 | native auth、目录本地同步、账号 import 与 scrypt 兼容；未真实导入。 |
| 2 | T2 剩余依赖收口 | T1 的模式选择/actor 契约 | Support 限制可见、费用/媒体/观测边界；独立阅读可提前并行，但 Gateway 集成在 T1 后。 |
| 3 | T3 候选编排与运维安全门 | T1/T2 的 native/offline 能力边界 | standalone 配置、legacy 默认不变、受限运维模式、README 与最小本地验证。 |
| checkpoint | P1 生产切换 | 本地交付 + 下列阻塞均消除 + 新授权 | 人工决策点；不是本轮执行任务，不部署、不停用。 |

<tasks>

<task type="auto" wave="1" id="T1" owner="main-and-existing-backendworker">
  <name>交接 native auth、原账号与团队关系边界</name>
  <files>
production-lab/meilin/gateway/server.mjs
production-lab/meilin/gateway/fg-team-stories.mjs
production-lab/meilin/canvas/backend/internal/auth/auth.go
production-lab/meilin/canvas/backend/internal/auth/password_fg.go
production-lab/meilin/gateway/fg-auth.mjs
production-lab/meilin/gateway/migrate-platform-accounts.mjs
production-lab/meilin/canvas/Dockerfile
production-lab/meilin/compose.yml
production-lab/meilin/canvas/web/src/components/auth/fg-session-recovery.tsx
production-lab/meilin/canvas/web/src/components/auth/require-auth.tsx
production-lab/meilin/canvas/web/src/lib/fg-entry-url.ts
production-lab/meilin/canvas/web/src/pages/auth/forgot-password.tsx
production-lab/meilin/canvas/web/src/pages/auth/login.tsx
production-lab/meilin/canvas/web/src/pages/auth/register.tsx
production-lab/meilin/canvas/web/src/pages/settings/index.tsx
production-lab/meilin/canvas/web/src/pages/settings/profile-pane.tsx
production-lab/meilin/canvas/web/src/router.tsx
production-lab/meilin/canvas/web/src/services/api/auth.ts
production-lab/meilin/canvas/web/src/vite-env.d.ts
  </files>
  <action>
1. 接收主进程显式认证模式实现（当前候选为 gateway/fg-auth.mjs 的 FG_AUTH_MODE=platform|native），不重复深入实现 auth。legacy/platform 默认继续访问 FG；standalone 明确选择 native。native 不解析旧 FG session 当作原生会话，不回退 Next；复用 Go 现有登录/登出/session。确认 Set-Cookie、origin 校验、禁用用户与超级管理员边界均沿用已有安全模型。
2. 主进程在 native 分支将 native users 同步进 fg_accounts；保留原始 UUID，保留既有 fg_groups、fg_memberships、成员角色、归档/离组状态，不因刷新覆盖人工管理结果。完全绕过 refreshAccounts()/bootstrapTeam() 的旧 HTTP，projects GET 与全部 team API 均覆盖；legacy 分支原行为保留。
3. 对齐已出现的 worker 写集：账号离线工具为 gateway/migrate-platform-accounts.mjs，密码兼容为 backend/internal/auth/password_fg.go 与 auth.go；本地验证已记录于 STATE.md，真实数据库模式未运行。工具默认 --dry-run，显式 SOURCE_FG_DATABASE_URL/TARGET_NATIVE_DATABASE_URL，--apply 另需真实数据写入授权；本轮不运行任何连接 DB 的模式。FG 原 hash 由 lib/local/password.ts 产生，候选 importer 加 fg-scrypt$ 前缀，Go 用既有 golang.org/x/crypto/scrypt 固定 N=16384/r=8/p=1、hex 文本 salt、恒时比较，原生 bcrypt 保留。候选明确不自动 rehash（旧密码可超过 bcrypt 72-byte 边界），不得另加隐式升级。源 app_users schema 无 status；应严格拒绝未识别的 status/disabled 字段变化，保留已有 native active/disabled，不把“源没有状态”说成“源状态完整迁移”。superadmin→native admin，旧 user/member/admin→native user 是现有桥接映射；原 fg_accounts.platform_role 与既有目标角色一致性须复核，不得擅自提权/降权或覆盖非空密码。账号工具不迁 sessions、groups、项目或资源；命令/输入/冲突检查与实际运行验证交接缺一仍为待验收。
4. 数据验收分开记录：A 原用户账号；B 已存在于 Yingce 的项目/画布/资源/费用与 fg_groups/fg_memberships；C 尚留在旧站的 groups/memberships 及可能的旧项目资产。账号 importer 不含 C 的 groups 迁移，不能报告全量数据迁移。已有组保持原 ID；只有确需首次导入旧组时，复用 importedGroupID() 的稳定映射并保持成员 UUID、角色、归档/离组状态，禁止重新随机生成 ID 或重跑“小组3”归属逻辑。
5. 若尚无旧 groups 导入能力，当前本地仅交付原生目录和既有关系保留；首次接入未导入旧组的环境明确阻塞于 P1，不静默新建替代组、不伪装 teamImported 已完成。完整 groups importer 是经确认需求后的独立迁移授权，不混入本轮数据库操作。旧项目若未迁入也同样阻塞，不为此推定迁全仓业务。
  </action>
  <verify>
仅当执行者确认已有测试不会连真实服务时：
- node --check production-lab/meilin/gateway/server.mjs
- node --check production-lab/meilin/gateway/fg-team-stories.mjs
- node --test production-lab/meilin/gateway/policy.test.mjs production-lab/meilin/gateway/fg-team-stories.test.mjs
- cd production-lab/meilin/canvas/backend &amp;&amp; GOPROXY=off GOTOOLCHAIN=local go test ./internal/auth ./internal/handler -run 'TestPasswordLoginPreservesConcurrentDisable|TestProfileRoutesRejectAnonymousBeforeMutation'
不改测试文件；上述已有测试不足以证明新增 native 分支或 scrypt 兼容。复核实际 diff 的 native 调用链无 platform fetch，并在用户追加授权的新建本地测试库完成真实 CLI、Go 登录与浏览器验收；禁止读写生产库或将 synthetic 数据结果当作真实业务迁移证据。
  </verify>
  <done>
主进程的本地 diff 显示 native auth/目录脱离 Next、legacy 默认不变；记录实际验证结果。账号、现存关系保留、旧 groups 未迁入三种状态分别可见；不将“代码已交付”写成“账号已导入”或“全量迁移完成”。无 import 交接或密码兼容证据时 T1 仍未完成。
  </done>
</task>

<task type="auto" wave="2" id="T2" depends_on="T1" owner="main-after-auth-integration">
  <name>收口 Support Bot，并限定观测、费用和媒体的改动范围</name>
  <files>
production-lab/meilin/gateway/server.mjs
production-lab/meilin/canvas/web/src/services/api/support-assistant.ts
production-lab/meilin/canvas/web/src/components/feedback/support-assistant-button.tsx
production-lab/meilin/README.md
  </files>
  <action>
1. 最小本地交付不迁整套机器人：仅在 native standalone 模式对旧 /api/support-bot/* 路径给明确不可用响应（503 与稳定 reason），不得代理回 Next 或误落 Go 通用 API；不影响已有独立 nativeSupportRoute 的内部只读 token 隔离。旧模式不改变行为。web 客户端识别不可用并停止无意义的轮询/SSE 重连，现有按钮/会话区域明确提示“独立模式尚未接入自助排查”，不显示已成功提交或可持续诊断。不要用 native cookie 调用旧 Next handler。
2. README 记录本地暂不可用的准确范围：网页 POST/轮询/SSE/截图/取消、飞书事件/process/worker。生产实际启用情况尚未核验，故这不是获准下线功能；P1 必须决定并验收迁移或取得明确的能力退役授权。若确认必须保留，复用 lib/support-bot 现有能力并单独制定有界迁移，复用原生身份；本轮不另建认证/机器人基础设施，不把临时不可用当全功能替代。
3. 费用保持现状：fg-fee-sync/fg-fee-usage/fg-fee-auth、fg-finance 与账本/凭据卷不修改，除非发现确凿 Next 调用证据。stdout 观测不重写，只核实 T1 的可信 actor 赋值及无敏感日志；旧观测 API 的迁移/安全拒绝由 T3 运维分支收口。
4. 媒体只核对明确调用和路由，不新增通用 URL 代理或替换数据库字段。保留原生 public capability、私有访问隔离、Range/流式传输以及现有项目/资源 ID。README 列出旧 /api/local/storage/content 与 /api/production-lab/assets/:id/content 为待确认历史引用；获得后续只读数据审计授权后，按实际 URL 类型确认所需的受限 reader/映射，不读取任意 URL、不绕过签名/归属。只要实际资产仍需要旧 handler，P1 不得宣称 Next 可以停。
  </action>
  <verify>
- node --check production-lab/meilin/gateway/server.mjs
- cd production-lab/meilin/canvas/web &amp;&amp; VITE_FG_AUTH_MODE=native FG_CANVAS_BASE_PATH=/fg-six/ bun run build（包含 TypeScript；仅使用已安装依赖）
- node --test production-lab/meilin/gateway/fg-fee-sync.test.mjs production-lab/meilin/gateway/fg-fee-usage.test.mjs production-lab/meilin/gateway/fg-fee-auth-route.test.mjs production-lab/meilin/gateway/fg-fee-rejections.test.mjs
- 静态核对 server.mjs 的 native Support 路由、客户端不可用分支和 SSE 退出路径；确认没有新增 fetch(platform)、没有编辑费用/媒体数据写入逻辑。
不把费用 mock 测试说成真实对账成功；不把媒体 URL grep 无匹配说成数据库无历史引用；未获隔离运行授权时不做真实 HTTP/截图验收。
  </verify>
  <done>
本地 standalone 不再隐式访问 Next Support API，不伪报机器人可用；费用与原生媒体保留。历史媒体、飞书、完整 Support 迁移仍列为生产阻塞，除非已有明确证据和授权消除。
  </done>
</task>

<task type="auto" wave="3" id="T3" depends_on="T1,T2" owner="main">
  <name>交付 opt-in standalone 入口及不会复活旧 app 的运维候选分支</name>
  <files>
production-lab/meilin/compose.standalone.yml
production-lab/meilin/tls.conf
production-lab/meilin/gateway/server.mjs
scripts/auto-deploy.sh
scripts/service-monitor.sh
scripts/nas-supervisor.sh
scripts/observability-outbox.sh
production-lab/meilin/README.md
  </files>
  <action>
1. 验收 compose.standalone.yml 作为 production-lab/meilin/compose.yml 的显式 overlay，复用已有 web/backend/gateway/agent/TLS，不纳入旧 Next app。采用 T1 的 FG_AUTH_MODE=native、web 的 VITE_FG_AUTH_MODE=native；消除 native 启动时对 FG_PLATFORM_URL 的必填/访问要求。保留已有服务、profile、NAS guard、资源与凭据卷；共享 fg-studio 网络还承载签名媒体等跨栈访问，保留网络不算 Next 依赖，不擅改卷/网络名或造空数据库。根 docker-compose.yml/default.conf 默认入口保持不变；需要包含 Go 密码兼容代码的 backend/migrate 和 native web 镜像，不能只切 gateway。
2. standalone 的 TLS 全路径进入 Gateway；调整 Gateway 的 /、登录/登出、静态资源、深链/刷新与旧入口 /workspace、/production-lab 的最小跳转，目标均为同一 native 工作台，不回旧 Next 登录页、不制造 /fg-six 重定向环。继续允许必要的匿名原生登录/静态资源，以及已有公开分享 capability；未登录业务 API 不能放开。tls.conf 只在确有必要时修改且不得改变 legacy 默认配置。外部 origin/Cookie secure/path、WebSocket、SSE、Range 保持原边界。
3. 运维脚本增加明确 opt-in runtime target（默认 legacy/Next 保持原语义）；native 分支的 monitor 读取 Gateway /health/live、/health/version 与 web 的 /.well-known/fg-runtime.json（按 /fg-six 前缀检查实际可达路径） 的真实字段。逐个核对实际路由，未找到的路径不能假设可用。auto-deploy 旧模式保留拉取后重执行最新脚本、APP_DEPLOYMENT_VERSION build arg、实际运行版本校验；native 版本不硬套旧 deploymentVersion。native 自动部署/恢复若未实现就明确拒绝该动作，绝不回退构建/重建 app、伪称部署成功或启动空库。
4. nas-supervisor 的 native 目标继续只承担既有 NAS 探测/保护，不因缺少旧 app 启动/重建旧容器；缺少已验证的 native 恢复实现则保留 NAS guard 并告警，不绕过保护。不删除或停用任务，也不在本轮改生产读取的配置来激活新分支。report-scheduler 实际入口未定位，不能假设同改这几份脚本就完成全部运维迁移。
5. native 模式的观测保留 stdout 与现有本地 outbox；旧收集器未移植时不对 Next 反复上报，不删排队事件、不假 2xx、不无限新增重复事件。现有脚本扩展最小的“仅入队/暂缓 flush”分支即可，不新建收集平台。不要把这些仅保存、尚未消费的日志称为原报表/告警功能完全替代。
6. README 明确启用组合、原生版本检查、现有卷/数据库必须复用、未执行导入/部署、支持能力缺口和 P1。当前项目 release/build 规则不因此升级依赖。不创建额外计划/报告/测试文件。
  </action>
  <verify>
- bash -n scripts/auto-deploy.sh scripts/service-monitor.sh scripts/nas-supervisor.sh scripts/observability-outbox.sh（仅解析，禁止执行或 source）
- node --check production-lab/meilin/gateway/server.mjs
- node --test production-lab/meilin/gateway/fg-public-entry.test.mjs production-lab/meilin/gateway/fg-workspace-entry.test.mjs production-lab/meilin/gateway/policy.test.mjs
- 若本机已有 Compose 且可用纯占位 env 满足插值：docker compose --project-directory production-lab/yingce -f production-lab/meilin/compose.yml -f production-lab/meilin/compose.standalone.yml config --quiet。先检查 env_file/include 路径，不加载生产 env、不执行 package.json 的 docker:config（该脚本会 mkdir）；不 up/build/pull。
- 对解析结果静态确认未引入 app 服务、明确 native、卷和端口未改变旧默认；逐分支审查脚本 native 模式没有落回 legacy 启动/构建/重建，也没有 stop/kill/disable/卸载操作。不能只用 grep 的“没有 FG_PLATFORM_URL”代替调用链检查。
- git diff --check；只检查本次改动，不回滚主进程/其他 worker 的变更。缺少工具/依赖时记录具体原因，不联网安装来补验。
动态候选验收须另获允许启动隔离本地栈及隔离数据写入的授权；当前静态任务不启动任何服务。获准后才能以无 Next 容器的环境验证登录/登出/session、disabled/role、projects/team、静态资源/刷新、分享/私有隔离、WS/SSE/Range，以及旧域名不可达时核心访问成功。未做时不写“端到端通过”。
  </verify>
  <done>
存在可解析的本地候选编排，默认旧配置不变；native 不需要 Next、不会由运维分支复活旧 app。实际执行的验证与未覆盖动态风险如实记入 STATE。仅可报告“本地代码候选已交付”，不可报告“已切换/已停旧站/全功能与全量数据已迁移”。
  </done>
</task>

</tasks>

## 迁移与回滚（设计边界，当前不执行）

- 原账号：`gateway/migrate-platform-accounts.mjs` 默认 dry-run，校验 UUID/email/username、角色和 schema，不能只按邮箱新建 ID。不改变既有角色或复活 disabled。旧 hash 使用显式 fg-scrypt 前缀，Go 固定参数校验；已有非空 native 密码保留，不自动 rehash，没有明文不能离线转换 bcrypt。
- 原 groups：现有 fg_groups/fg_memberships 留存不动；缺失的旧组另行确认是否需要导入。任何未来导入必须给出原组→稳定 ID、原成员 UUID→成员关系、manager/普通角色、归档/离组时间的逐项 dry-run 核对，并保证幂等且不覆盖现有本地管理结果。当前未实现、未执行。
- 项目/资产：既有原生项目、画布、资源、grants、NAS 路径与费用表不迁不删；旧站资产是否仍被引用需后续授权的只读清单确认。不得把账号迁入等同旧项目或媒体迁入。
- 本地回滚：未合入/未切流的候选只停止选用 standalone 配置，保留 legacy 默认；不得 git reset/覆盖其他 agent 工作。
- 未来生产回滚：仅在明确授权后，把入口和 runtime target 恢复到已确认的旧模式，不重建 UUID/不自动回滚数据库/不删除新增用户或资产。当前不自动 rehash，但 native 改密不回写 FG，配置回切不会同步新密码或会话；必须独立验证密码分叉后的回切策略。不得默认增加旧密码副本。
- Cookie/原有 session 是否可跨模式保留不是默认承诺；若需要重新登录，须作为切换影响说明。旧 handler 仍有实际资产/队列依赖时，单纯回切路由不足以证明可退役。候选 importer 的“恢复目标备份”只描述离线工具维护边界，不构成本轮业务库恢复/覆盖授权。

<production_checkpoint id="P1" type="checkpoint:human-verify" blocking="true">
  <gate>本轮禁止越过；不是自动执行节点。</gate>
  <requirements>
1. 收齐主进程/worker 的实际文件与验证记录；T1/T2/T3 的本地范围真实完成，静态与动态验证分开报告。
2. 明确账号迁移覆盖范围、旧 groups 是否缺失、既有组/成员/项目/费用不变、历史资产 URL 是否仍需 Next；没清楚就不能停旧站。迁移代码存在不等于数据已迁移。
3. 确认 Support 网页/飞书/worker、观测持久化/报表及外部回调的实际启用情况；必须保留的能力先交付替代并验收，允许退役的能力取得针对性授权，不能靠未知状态放行。
4. 检查 NAS supervisor、service-monitor、auto-deploy、report-scheduler、six runtime-requests、six yingce 的下一轮目标和真实入口，保证不会重建旧站、不被新健康协议误判；保持所有受保护任务运行。源文件未找到的调度器依赖仍是阻塞，不能修改未知系统配置。
5. 独立获得生产部署/流量切换授权；任何停止具体旧进程/容器/服务的操作须单独明确授权目标与影响。本计划、一般退役目标、部署授权均不替代生产停用授权。数据库写入/迁移另行授权，数据删除不在范围。
6. 提供经过验证的入口回切、版本核对、密码 hash 回切与会话影响方案；不能用恢复备份/清库作为本轮默认回滚。
  </requirements>
  <resume_signal>用户对具体切换范围明确授权，且上述技术/数据缺口有证据关闭后，主进程才可另行制定生产执行步骤。</resume_signal>
</production_checkpoint>

## 本轮执行结果

| 范围 | 本地交付 | 仍不能据此宣称完成的事项 |
| --- | --- | --- |
| T1 | native 认证/目录、原生前端、scrypt 与 CLI 已实现；真实浏览器/synthetic Go 登录通过，两个本地旧库共 3 个用户已迁入并验收备份恢复、幂等与字段保留 | 生产规模历史业务副本、邮件/OAuth/SMS；三个旧账号原密码未实测 |
| T2 | Support 明确未接入，真实浏览器确认无旧站 HTTP/SSE；原生画布与上传资源保存刷新成功 | 完整 Support/飞书/报表保留、旧 groups 与历史媒体迁移 |
| T3 | standalone 保留原服务/卷/网络并隔离候选镜像；脚本 opt-in 且不回退 Next；静态检查通过 | native 自动部署、NAS 容器恢复及 Go guard、真实私有网络/证书验收 |
| P1 | 未放行，生产入口/数据/进程未改动 | 共享 IP 登录限流、数据/能力缺口及各项生产操作独立授权 |

已运行的主要检查（仓库根目录；花括号是同一 argv 的简写）：

```bash
node --test production-lab/meilin/gateway/{policy,fg-team-stories,fg-public-entry,fg-workspace-entry,fg-canvas-realtime,fg-speech-stream,fg-fee-sync,fg-fee-usage,fg-fee-auth-route,fg-fee-rejections,fg-canvas-owners,fg-editor-leases,fg-creator-media}.test.mjs
bash -n scripts/auto-deploy.sh scripts/service-monitor.sh scripts/nas-supervisor.sh scripts/observability-outbox.sh
(cd production-lab/meilin/canvas/backend && GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./internal/auth)
(cd production-lab/meilin/canvas/web && env -u VITE_FG_AUTH_MODE bun test test/{fg-entry-url,password-reset,auth-registration-agreement,auth-theme,profile-settings,profile-session,http-ownership}.test.ts test/fg-session-recovery.test.tsx)
(cd production-lab/meilin/canvas/web && VITE_FG_AUTH_MODE=native FG_CANVAS_BASE_PATH=/fg-six/ bun run build)
git diff --check
```

Gateway 最终 47/47、前端 29/29、Go auth 和前端构建通过。本轮实际启动本地 Gateway/Nginx/Go/PostgreSQL/Redis，完成 15 个真实业务场景及 synthetic 迁移 60/60 断言，入口保持在 http://127.0.0.1:43016/fg-six/；运行边界、命令和结果见 STATE.md。已修复 logo 匿名访问、旧入口尾斜杠和 native 设置文案并实测。真实独立 Go WebSocket 在改密后由 15 秒心跳以 1008 撤销，不承诺立即断开。既有 superadmin 管理 user/member 私人内容的授权不改变；不宣称所有跨管理员/成员访问均拒绝。当前对不可信转发头保持清洗，多用户 IP 限流共享问题在 P1 前必须关闭。

<verification>
实际执行结果记录在 .planning/STATE.md，包括已有专项测试、Go 验证、双模式前端构建、隔离真实服务/浏览器、synthetic 数据库迁移与编排静态验证；禁止新增测试文件。没有真实历史业务数据、NAS/外部服务和完整 Compose 的端到端证据，不宣称完整业务独立运行；没有 P1 授权和在线版本证据，不宣称生产完成。
</verification>

<success_criteria>
本地候选：native auth/目录脱离 Next、保持旧默认、既有数据不变、剩余依赖明确可见且不隐式回退、编排/脚本通过适用的本地检查。
生产退役：只有 P1 后单独验收；本轮始终待授权/待核实，不与本地候选混为一个完成状态。
</success_criteria>

<output>
只更新既有 .planning/STATE.md 的目标、证据、实际验证和待完成项。计划本身不自动创建 SUMMARY、测试文件或提交。
</output>
