# 当前状态

- 日期：2026-11-10（Asia/Shanghai）。
- 当前目标：紧急修复自助排查助手不能具体定位及解惑的问题，暂不改生成任务本身；既有主站退役工作及 P1 生产 checkpoint 保持原边界。
- 当前计划：`.planning/phases/support-investigation/PLAN.md`；主站退役记录：`.planning/phases/main-site-retirement/PLAN.md`。
- 当前状态：助手优化已在本地实现并离线回放；尚未发布、补齐生产 worker 源码或验收真实模型效果。主站退役仍只完成本地 native 认证、编排与运维候选及 3 个旧用户迁入，不是完整退役，也未生产部署。

## 本轮助手紧急修复（2026-11-10）
- 已实现：新增本人 Canvas 任务 `generation` 只读核对，成功任务也检查角色样音绑定与最终请求/上传映射；识别具名对白与删样音标记冲突，按实际标记读取引用过滤及请求组装实现。
- 已实现：已核实提交异常或明确上游拒绝可独立输出 observed 事实、参数要求、责任环节和处理边界；不再因缺少最终内部归因、模型失败或校验失败而统一丢弃。内部根因 confirmed 仍要求匹配运行源码及真实因果；临时操作须有运行实现依据，不让用户盲目改提示词、重传或付费重试。
- 已实现：预检增加历史任务输入/调用请求字段的 LIMIT 0 读取，字段或权限不足明确拒绝 ready；只读数据源缺口不归因用户。有效证据的待验证分析与已知事实分开展示，不能冒认内部根因。
- 已验证：`pnpm exec tsc --noEmit --incremental false --pretty false`、既有 AI/日志测试 12/12；真实问题取证/负例 23 项、完整调查函数回放 15 项、上游错误/预检 20 项、本地 PostgreSQL 实查 10 项通过；前轮回放兼容检查 31 项及 runtime/preflight 21 项通过。31 项 fixture 仅在内存调整原固定长度/措辞断言，其余安全约束保留；未修改仓库测试。日志异步落库告警仍未作为落库成功验收。
- 本地实查只临时新增并清理 synthetic owners/tasks/calls，验证 active 映射、双重归属、时间/项目过滤和 READ ONLY；没有修改现有用户或生产数据库。原始证据仅留受限 `/tmp`，签名 URL/正文不进入 Git。
- 边界：只完成助手本地增量，未修生成任务自身，未 commit/push/部署或调用真实模型；不能宣称线上已生效。生产 worker 源码对象与发布 checkpoint 保持未关闭。

## 前轮助手优化（2026-11-10）
- 依据：11:54 的生产工单已在前轮只读定位；本轮仅使用其本地留存的受限证据离线回放，没有再次 SSH、写生产或操作守护任务。
- 已实现：详情业务错误与工具失败分离、FG 链路正确合并错误详情、任务编号按业务服务隔离（含服务端后续发现的编号）、链路分支不隐式继承页面任务/会话编号、任务与浏览器失败请求分别取证并限制浏览器线索时间窗。
- 已实现：未定位答复改为已查事实/缺口/接手动作，完整调查留 internalSummary/evidence；校验日志记录具体规则与次数，同样失败且无新证据时停止重复修复；预检明确输出运行提交/源码可用性与处理提示，required 源码缺失拒绝通过，不自动 fetch。
- 已验证：root `pnpm exec tsc --noEmit --incremental false --pretty false`；既有 AI 文本/兼容客户端/日志测试 12/12；临时工具、报告及完整调查函数检查 31 项；runtime/preflight 隔离场景 21 项。真实工单的 2447 字符答复缩短至约 400 字符，仍明确未定位且不把保存 409 当作生成失败根因。
- 边界：本轮未 commit/push、部署、真实模型调用或新增仓库测试文件。前轮人工反馈未提交改动完整保留；生产发布仍需单独授权，并准备对应运行提交的源码、先执行反馈 021 增量迁移；native 工作台助手仍未接通。本轮不关闭下方主站退役 P1 待办。

## 授权与安全边界

- 用户先授权本地实施，随后明确要求启动项目并做实际测试；允许本轮新建隔离测试数据库、运行本地服务及 synthetic 账号迁移，不含生产部署/切流/停用、SSH、真实业务数据库迁移或真实 NAS 操作。
- 2026-11-06 用户明确要求迁入旧站用户，并限定“只处理本地数据库，不要动生产环境”：允许只读读取本地旧库或其副本、向本轮 native 库写入旧账号；不授权任何生产连接、SSH、旧库修改、生产部署或停服。
- 前次仅静态与短生命周期 fixture 检查；本轮实际服务和 backend worker 只连接新建测试库、本轮 Redis 和本地空 NAS 目录，没有旧 Next 主站或生产环境依赖。未运行生产脚本，未自动 commit/push、升级依赖或新增/修改测试文件。
- 六个已知 LaunchAgent 及后续生产任务继续受保护；一般迁移或部署目标不构成停用授权。

## 已交付的本地代码

- [x] Gateway `FG_AUTH_MODE=platform|native`，默认 platform 不变。native 向既有 Go session API 校验，只转发原生 Cookie，不访问旧 Next 认证。
- [x] native 的用户角色/禁用状态以 Go users 为准；既有 user/member/admin 低权限标签保留，不能由陈旧 superadmin 映射恢复权限。可信内部会话缓存命中前也检查 active/role。
- [x] 登录、注册/验证码、找回密码和 OAuth 精确公开路由；写请求仍要求受信 Origin。静态构建资源与 runtime manifest 可匿名读，业务 API 不开放。未登录深链仅返回固定 SPA 外壳，Router 保留 query/hash 后站内登录。
- [x] 团队目录 native 分支只从本地 users 同步 fg_accounts，不请求旧 `/api/production-lab/admin`，不重新导入或覆盖已有 fg_groups/fg_memberships。
- [x] 前端 `VITE_FG_AUTH_MODE=native` 复用既有认证页面与密码/邮箱安全入口；默认 platform 不变。保留退出/缓存隔离，登录服务异常不跳旧主站。
- [x] 画布 WebSocket 在 native 模式透传原浏览器会话，复用 Go 既有心跳撤销；创作/语音 capability 的 owner 同时支持 32hex 与 UUID，操作标识仍按原 UUID 规则。
- [x] 离线账号迁移 CLI：默认 dry-run、显式 --apply；校验不同库、schema、UUID/email/username/role 冲突，目标事务写入。保留既有非空 native 密码、禁用状态和原 UUID，不复制浏览器 session。
- [x] Go 显式支持 `fg-scrypt$` 旧密码，固定 KDF 参数且 constant-time 比较；bcrypt 保留，不自动 rehash，支持旧 UTF-8 长密码。synthetic Go 登录已通过，本地旧站 3 个账号的原 hash 已完整导入；未连接生产源库。
- [x] native Support 明示“尚未接入”：前端不发送问题、截图、SSE 或轮询，Gateway 返回明确 503，不隐式访问 Next。此为可见缺口，不是 Support 保留迁移完成，也未停用 production 的旧能力。
- [x] standalone Compose 显式 native，web/backend 源码构建并使用独立候选镜像 tag，backend/migrate 同镜像；原有卷、服务、共享/私有网络边界不擅改。脚本增加默认 platform 不变的 opt-in 目标，native 不回退重建 Next；自动部署拒绝、NAS 保留 guard、outbox 暂缓消费均明示为未完成能力。

## 既有及本轮回归验证

- Gateway 语法：`node --check` 检查 `gateway/{fg-auth,server,fg-team-stories,migrate-platform-accounts,policy,fg-canvas-realtime,fg-creator}.mjs`，通过。
- Gateway 最终集成专项：`node --test` 覆盖 policy、team-stories、public-entry、workspace-entry、canvas-realtime、speech-stream、fee-sync、fee-usage、fee-auth-route、fee-rejections、canvas-owners、editor-leases、creator-media，47/47 通过。
- WebSocket/owner 修正后另运行 `node --test fg-canvas-realtime.test.mjs fg-creator-media.test.mjs`，2/2 通过；转发头清洗修正后 policy 专项 7/7 通过。临时原生 WS fixture 确认转发原浏览器 Cookie、不透传 FG/Authorization；未冒充真实 Go 注销联调。
- Go：在 `canvas/backend` 以 `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local` 运行 `go test ./internal/auth`，通过；另以临时非测试程序对比 Node crypto scrypt 向量，UTF-8 >72-byte 密码兼容，错误密码/畸形 hash 拒绝。
- 前端既有专项：在 `canvas/web` 运行 `bun test test/{fg-entry-url,password-reset,auth-registration-agreement,auth-theme,profile-settings,profile-session,http-ownership}.test.ts test/fg-session-recovery.test.tsx`，29/29 通过。
- 前端构建（含 TypeScript）：platform 默认与 `VITE_FG_AUTH_MODE=native FG_CANVAS_BASE_PATH=/fg-six/ bun run build` 均通过；Support 边界修改后 native 再构建通过。仍有已有资源解析/动态 import/大 chunk 警告。
- 临时 `node --input-type=module` fixtures：native Cookie/路由/角色/禁用/故障、目录不联网、账号冲突与保留策略、loopback HTTP 登录 body/头过滤/Set-Cookie/响应流/上游错误均通过；1690 个实际生成的静态构建资源通过匿名路由边界检查，包括带 `~` 的 Vite chunks。最终缓存断言通过：auth、HTML 外壳和 runtime manifest 保持 no-store，assets/fonts 保留上游静态缓存策略。
- CLI `--help`、缺少连接参数、冲突参数、同库拒绝检查通过；本轮实际连接隔离 PostgreSQL 的 dry-run/apply 结果见下节。
- 原生前端临时 Bun 断言：站内登录、basepath/query/hash、恶意 next 拒绝通过；Support 读/写/取消拒绝且不创建 HTTP/SSE。Dockerfile 的 native ARG/ENV 已放到既有 platform 测试之后，避免让原有平台语义测试误用 native 环境；只验证顺序，未构建镜像。
- Compose 使用临时假 env 与隔离进程环境执行 `docker compose --env-file <fake-env> ... config --format json`，8 组覆盖默认/native/自定义镜像/meilin/清除旧平台变量/support-host/Suno/媒体；226 项配置、15 项 native 路由静态断言通过。这组检查未连接 Docker daemon 或执行 build/up；本轮另外只在本机 Docker Desktop 新建两只测试容器，未运行完整 Compose 或构建应用镜像。
- `bash -n scripts/auto-deploy.sh scripts/service-monitor.sh scripts/nas-supervisor.sh scripts/observability-outbox.sh` 通过；只解析未执行。`gofmt -l` 无输出。`git diff --check` 通过。

## 2026-11-05 实际启动与端到端验收

- 入口保持运行：`http://127.0.0.1:43016/fg-six/`。真实链路为 native Gateway → 本轮 Nginx `43018` → 当前源码编译的 Go backend `43080`。独立 PostgreSQL 17.11 位于 `127.0.0.1:55461`，Redis 7.4 位于 `127.0.0.1:56389`；两容器仅本地绑定，label 为 `fg.task=native-e2e-20261105`，不使用既有卷或 restart policy。未启动 Next 主站。
- 本轮配置、随机测试凭据、日志和截图位于 Git ignored 的 `canvas/.local/project-workbench-debug/`；`.native-e2e-current` 指向本轮目录，`runtime.json` 权限为 600。未读取生产凭据。注册只在本轮干净测试环境开启，正式编排的关闭默认值未改。
- Chrome DevTools MCP 无法连接、CUA 无可用浏览器后，使用独立 headless Chrome profile 与真实 CDP；实际点击、输入、上传、保存、刷新，不使用 mock 页面。15 个业务场景通过，浏览器未捕获 JavaScript exception。
- 实际 UI 完成首次注册管理员、原生登录、账户/设置、改密、旧密码拒绝、退出后旧会话撤销、邮箱登录普通成员及换账号无资产/UI 串用；Cookie 仅原生 HttpOnly 会话。未登录深链保留 `/fg-six/`、query 和 hash，重新登录后恢复。
- 实际 UI 创建、重命名画布，添加文本并保存；无缓存刷新后名称和内容仍在。PNG 实际落入本轮资源及素材表，图片解码成功、签名预览成功，刷新后素材仍在；匿名有效签名可读，无签名拒绝。
- 实际 Gateway → Nginx → Go WebSocket 建连；独立连接在改密撤销后由 Go 心跳以 `1008 session expired` 关闭，不把页面导航断开当作撤销证据。成员禁用后私有 API 401、浏览器回登录，恢复 active 不复活旧会话。
- 原生团队目录只同步本地用户；普通成员写团队与管理 API 被拒绝，陈旧 superadmin 标签不能提权。普通成员读管理员私人画布/原始资源为 404；**既有 Go 团队策略允许 superadmin 管理 user/member 的私人内容**，不是所有管理员跨用户访问均拒绝。低权限 admin 标签不变且不升级 Go role，其私人画布仍排除在该管理范围外；未改变这项既有授权规则。
- Support 按钮实际显示“尚未接入”，浏览器没有发出 support-bot HTTP/SSE；密码/邮箱入口保持站内，未配置邮件时明确提示。未发邮件、短信或调用真实 AI 供应商。
- 发现并修复：匿名品牌 `/logo.svg` 被拒绝、`/workspace/` 与 `/production-lab/` 尾斜杠真实 404、native 设置侧栏仍显示 FG 平台账号文案。前两项运行中复测通过（含 root/prefixed alias 8 路 302）；第三项 native 重建并在真实设置页确认已修复。团队目录起初 400 是本轮 `FG_TOPICS_FILE` 指向缺失文件，改为测试目录空选题文件后恢复，不是产品 SQL 故障。
- 隔离迁移由真实 CLI 执行 5 次、实际 Go 登录 3 次，60/60 断言通过：只读源角色拒绝 UPDATE；dry-run 零写入；apply 保留 UUID/role/status；再次 apply 幂等；alias 冲突整批不写；schema drift 在 schema_check 拒绝；200-byte UTF-8 旧 scrypt 密码登录成功，错误密码拒绝，disabled 用户禁止登录。既有非空 native hash、验证时间和禁用状态保留；源数据及 xmin 不变。源库仅 synthetic fixtures，不是历史业务副本。
- 本轮修复后重新运行：上述 Gateway 13 个既有 test 文件 **47/47**、前端 8 个既有 test 文件 **29/29**、`VITE_FG_AUTH_MODE=native FG_CANVAS_BASE_PATH=/fg-six/ bun run build`（含 TypeScript）均通过；仍有已有资源解析/动态 import/大 chunk 警告。未新增依赖或测试代码。
- 收尾检查：Gateway `/health/live`、Go `/api/health/ready`、真实 Web、runtime manifest 和 logo 均 200；`node --check gateway/{fg-auth,server}.mjs`、PLAN XML 区块解析及 `git diff --check` 通过。所有改动未包含测试代码、lockfile、截图或运行产物；diff 与未跟踪交付文件未包含本轮随机测试凭据。

## 2026-11-06 本地旧用户迁入

- 来源一：原本地主站 `fg_studio`，位于已停止的 `fgai-app-postgres-1` / `fgai-app_postgres-data`，共 **1 个 superadmin**。确认原卷没有运行中的挂载者、PG16 状态为 shut down 后，以只读挂载复制到本轮新卷，只运行副本；没有启动或修改原容器/卷。
- 来源二：当前 `.env.local` 指向的本机 `127.0.0.1:55440/fg_support_local`，共 **2 个 user 测试账号**。使用 REPEATABLE READ READ ONLY 导出用户及 profiles，写入本轮隔离账号快照库；没有修改原库。两个来源的 UUID/邮箱互不冲突。
- 目标仍是 `http://127.0.0.1:43016/fg-six/` 的本轮 `fg_native_e2e`。实际 CLI 分别新增 1+2 个用户及对应账号关联，当前总用户数 **7**（原 4 个验收 fixture + 3 个本地旧账号），不是导入了生产用户。
- 迁移前完整 `pg_dump --format=custom` 备份为 600 权限，并实际恢复到独立库，**164 张表的数据指纹一致**。在恢复库先完成两个来源的 dry-run、apply 和幂等演练，再写当前运行库；实际再次 apply 均新增 0 个用户/关联。
- 逐字段核对三个账号的原 UUID、邮箱、完整 `fg-scrypt$` hash、角色映射、账号关联、创建时间及邮箱验证时间；时间保留到源 PostgreSQL 微秒精度。发现原 CLI 新建账号遗漏邮箱验证时间、Date 转换截断精度，已修复并以实际账号验证；既有用户的非空密码、禁用和验证状态不覆盖。
- 原有 163 张表数据指纹保持一致；`fg_company_settings` 的业务值也不变，仅既有 `wetokenFeeSync` 每分钟刷新 `updated_at`，不将运行时刷新误判成迁移写入。两个源的 app_users/profiles 数据及 xmin 不变，原本地 PostgreSQL 容器保持停止。
- 迁移完成时，真实 Gateway → Go 管理接口返回 200，能按原 UUID/邮箱读取全部 3 个迁入用户；健康入口 200。没有旧账号明文密码，**未声称已实测这三个账号的原密码登录**；迁移过程中未重置密码，旧 hash 兼容性另有前述真实 synthetic Go 登录证据。迁移后的本地改密和复查状态见下节。
- 验证入口：`gateway/migrate-platform-accounts.mjs --dry-run` / `--apply`（连接值仅通过环境传入），两来源均无冲突；新增邮箱时间校验的 inline 断言覆盖原精度、无验证保持 null、无效时间拒绝。备份、连接配置和结果元数据位于 `.native-e2e-current` 目录下的 `local-user-migration-20261106-c5bdf6/`，均 Git ignored，凭据不进入文档/Git。
- 没有 SSH、生产数据库/接口请求、部署、切流、NAS 或生产守护进程操作；未 commit/push、升级依赖或新增测试文件。
- 收尾仅停止本轮临时启动的旧卷副本容器，保留副本卷、完整备份和恢复库；原旧容器状态不变，工作台继续运行。`node --check production-lab/yingce/gateway/migrate-platform-accounts.mjs`、`git diff --check`、PLAN XML 解析通过；在 `canvas/backend` 执行 `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./internal/auth` 通过。私有连接值和源密码 hash 未进入 diff/未跟踪交付文件。

## 2026-11-06 账号交付后的复查

- 用户忘记密码后，仅通过当前本地工作台管理 API 重置了一个迁入管理员的密码，保留 UUID、邮箱、角色和 active 状态；当时新密码登录、会话读取及退出均返回 200。没有回写旧库或生产，凭据仅保存在 Git ignored、权限 600 的 runtime 配置，不写入文档。
- 本次再检查确认本地入口、运行清单、logo 和 Gateway 健康均 200，旧入口尾斜杠均 302；管理 API 仍能读取全部 3 个迁入用户及原 UUID/邮箱，总用户数 7。
- 账号状态存在后续变化：本地审计记录在 2026-11-06 10:01:23（Asia/Shanghai）出现一次该迁入管理员的 `user.update`，10:01:31 有成功密码登录。本次使用此前交付的临时密码返回 401，不能把它继续当作有效凭据，也不能仅凭审计类型判定是谁改了哪些字段；未再次重置或覆盖当前密码。
- 独立测试管理员通过真实 Gateway → Go 完成登录、会话读取及退出，退出后读取不到用户；native Support 仍明确返回 503。本轮没有重做浏览器验收，也没有替真实邮件/SMS/OAuth、历史媒体或 NAS 补签。
- 重跑既有 Gateway 13 个 test 文件 47/47、Web 8 个 test 文件 29/29；`GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test -count=1 ./internal/auth` 通过。上述 Gateway/Web 文件与命令见前节；`node --check`（fg-auth/server/migrate-platform-accounts）、四个运维脚本 `bash -n` 及 `git diff --check` 通过。
- 尚未关闭的待办仍是下节的历史数据/关系盘点、Support 等保留范围、真实认证/业务集成、native 运维及可信代理限流、密码回切策略；生产切换不在本次授权内。仅修正现有文档的状态描述，没有新增测试文件、commit/push 或任何生产操作。

## P1 未关闭的边界

1. synthetic PostgreSQL 迁移、Go 登录、浏览器 Cookie/改密/退出已验收，本地旧站 3 个用户已迁入并完成备份恢复演练；生产规模业务副本上的数据量/schema/锁/事务与恢复、真实邮件/OAuth/SMS、关闭注册的运行配置仍未验收，不以本地或合成数据代替。
2. 账号迁移器不导入旧 groups/memberships，不迁旧项目/历史媒体；既有 native 关系不变。旧 `/api/local/storage/content` 与 `/api/production-lab/assets/:id/content` 是否仍被实际引用，需离线数据清单确认，不能凭源码 grep 宣称无依赖。
3. Support 网页/飞书/worker、观测收集/报表及外部回调的实际启用情况未确认。必须保留的能力需完成框架无关 adapter/worker 验收；允许退役的能力需针对性确认。可复用 core 在 `lib/support-bot/{store,web-stream,context,runtime,environment}.ts`，不能直接复用依赖 Next session 的 route。
4. 运维 native 候选不是完整自动部署/恢复：不回退重建 Next；原生自动部署和 NAS 容器恢复未实现，观测仅保留 outbox。NAS 宿主探测通过仍保留 guard，尚未验证 Go 消费该 guard，不能生产启用；monitor 必须使用匹配证书 SAN 的 HTTPS 地址与受信 CA。report-scheduler 等实际入口、私有工具网络与下一轮目标仍需逐项核验，不能停止守护进程绕过依赖。
5. native 保留非空本地密码；在 native 改密不会回写 FG。回切平台配置不会自动同步密码或会话，必须单独核实回切策略。
6. 生产默认配置和入口未切换，主站未删除/停用。生产部署、数据迁移、流量切换和停止具体服务须分别获得明确授权；本轮不越过该 checkpoint。
7. 当前候选剔除不可信转发头，登录 IP 限流仍可能由所有用户共用 Gateway 地址；可信 TLS 代理、每用户工具私网与真实客户端地址尚未核验。为避免伪造来源绕过限流，本轮不盲目信任 XFF/X-Real-IP；此项列入生产切换前必须关闭的问题。
