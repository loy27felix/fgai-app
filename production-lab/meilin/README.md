# FG Studio 第六板块 · 1.2.17

`canvas/` 保存画布源码和 FG 定制；`gateway/` 负责登录鉴权、故事立项、人民币报价与账单核销。默认仍使用平台登录；本地可选原生登录入口见[独立模式与账号迁移](#独立模式与账号迁移)。公司更新见根目录 `CHANGELOG.md`。

## 版本与隔离

FG 第六板块对外版本为 **1.2.17**，上一部署版为 1.2.16。画布上游同步至 `68491b4c`，创作台至 `b674f255`，导演台至 `5335a2ca`。保留各源码许可证和第三方声明；产品品牌、版本和更新链接使用公司仓库。

默认平台模式的外网入口通过原主站 HTTPS 端口代理第六板块：`/fg-six/` 为画布，创作与广告使用独立工具路径，导演通过 `/app` 和 `/api/v1`。这些路径在原五板块没有对应路由；该模式网关仍逐请求校验 FG 会话。`FG_EXTERNAL_PUBLIC_URL` 必须明确配置为公司外网 HTTPS 来源；不能使用来源通配符。Nginx 配置片段见 `entry.conf`，上线脚本校验后热加载并保留回退副本。

公司火山语音渠道包含 Seed Audio 1.0、TTS 2.0、录音文件识别 2.0、流式识别 2.0 和机器翻译。画布使用原生音频任务；创作台、导演台调用公司适配接口；广告入口保留原广告项目归属。部署及验收见 [SPEECH.md](SPEECH.md)。导演设置移除“关于”“市场”和通用设置的“许可与源码”界面；源码包与许可证继续保留在部署产物。

“灵感库”按图片、视频浏览六个公开提示词来源，提供提示词及来源详情。第六板块网关每 30 分钟检查更新，页面关闭后仍运行；旧内容在拉取失败时保留。Suno 公司账号准备与当前网页适配方案见 [公司音乐服务](../suno/README.md)，未填写私密 Cookie 时保持关闭。

独立 PostgreSQL、Redis、后台、前端、Agent 与网关；原五个板块不重建、不重启、不迁库。平台入口 `/production-lab`，独立服务默认 3016，后台 `/admin`。默认平台模式每次请求校验原平台登录态，全部成员可使用；审核、管理小组与账务设置限超级管理员。

## 业务与费用

故事选题 → S/A/B/C 立项、制作小组和人民币预算 → 项目 → 分集与制作画布 → 生成任务 → 人工选择与交付。请求保留用户、项目、画布与任务归属，预算不计入实际花费。

成员投稿先进入待审核，审核通过后进入共享故事库。故事项目可以关联多张画布，所有已登录成员可协作读写；个人自由画布和个人项目继续私有。共享媒体以项目授权表控制，不能通过伪造素材 ID 暴露他人的私有上传。保存保留原创建者、版本校验、历史快照及媒体引用保护，并非实时多人光标编辑。

小组成员可由超级管理员调配。`FG_GROUP3_ACCOUNT_EMAIL` 是首次导入分组时的私有配置，指定的账户归属小组3；后续管理员修改不会被刷新覆盖。新请求在数据库写入时固定小组名称，旧请求不按当前成员关系重算。

WeToken Key 仅保存在服务器渠道。生成前按模型、参考素材、比例、尺寸、画质、时长和分辨率展示人民币费率及估算。文本和图片 Token、未核验规格与 Seedance 参考视频最低 Token 用量不能冒充固定单次价格。

实际金额来自 WeToken 费用流水，`x-oneapi-request-id` / Reference ID 精确核销；异步视频保留任务编号。重复不重复计费，冲突中止导入，未唯一匹配的流水单独列出，不按时间或金额猜测归属。账户合计包含同账户其他系统历史消费；项目统计仅含明确归属请求。

授权会话保存到独立只读凭证卷。网关每分钟只 GET 固定账单接口、读取完整分页；不保存密码、不自动登录、不调用账户管理或充值接口。过期后暂停并提示重新授权，CSV 仍可补充核对。页面每 15 秒刷新，核销有供应商出账延迟。

人民币采用管理员配置的记账换算系数，历史核销保留当时系数；不是银行汇率或充值人民币实付金额。

## 持久化

上传及生成媒体存 NAS；上传必须取得服务器资源 ID，失败直接提示，不能返回浏览器本地上传成功。项目、画布、任务、费用记录存独立 PostgreSQL 持久卷，每日备份 NAS。浏览器缓存只用于读取加速和待同步草稿；服务端未确认的修改不能视为已保存。

`maintain-host.py` 检查 NAS 真实读写，挂载失效暂停新后端，避免写宿主机空目录。备份经 `pg_restore --list` 和读回摘要验证；未做停机灾难恢复演练。

部署工作区准备脚本时，同时将本目录的 `provision_storage.py` 放到两个 `provision-*.py` 旁边。后台目录准备通过临时、无网络、无 Docker socket 的受限存储容器执行；它校验 NAS 标记、账户 UUID 和目录实际路径后创建对应账户的工程及 recycle 目录。`com.fgstudio.six.yingce` 必须保持启用，`host-metrics/runtime-provision.json` 应持续更新；只手动运行一次准备脚本不能覆盖后续新用户。

小说首次进入请求由 `arcreel/deploy/runtime-requests.plist` 对应的 `com.fgstudio.six.runtime-requests` 每 5 秒检查，只初始化尚无工作区地址的请求账户；无新请求时不访问 NAS、不重建已有工作区。该脚本与常规定时维护共用互斥锁，避免同时创建同一账户的容器。常规维护继续负责已有工作区健康恢复。

第六板块个人文件总量不限额（资源策略 `storedFileGB=0`），已用空间继续统计；单文件、每日上传、任务和请求频控保留。提交前检查月额度与项目预算；超过上限、存在未确认金额或不能确定费用上限时暂停限额请求。后台系统性能展示团队素材原件已用和 NAS 挂载整体容量，使用率 80% 提醒、90% 强提醒。NAS 数值来自 Mac 挂载报告，可能包含其他文件及服务端虚拟容量，不应当作存储设备物理盘总容量；过期快照显示不可用。内存指标属于 Docker 虚拟机，任务与账单指标仅统计第六板块真实记录（含已有测试）。

团队初始并发：Agent 活跃对话 8、Worker 任务 4、WeToken HTTP 请求 4，超过对应上限按各自机制排队/等待或提示繁忙，不代表人数上限。支付协议在内部部署禁用；绘图工具是草图/构图编辑器配置，与付费 AI 生图模型不同。嵌入式工作台仅向第六板块来源委托麦克风，浏览器仍必须取得用户授权；本次验收不录音、不调用付费模型。

## 运行

1. 配置私有 `.env`：数据库、TLS、NAS、平台网络与三个镜像变量。凭证、账单、素材、备份不提交 Git。
2. 实际选题放 `private-data/topics.json`，Compose 只读挂载。JSON 数组字段包括 id、title、original、plot、style、markets、form、tier；人员映射只留私有数据。
3. 账单同步可选：设置 `WETOKEN_FEE_SESSION_FILE=/run/fg-secrets/wetoken-fee-session.json` 和 `FG_FEE_SYNC_ACTOR_ID`（已有授权 FG 管理员 UUID）。会话格式 `{cookie,userId,expiresAt}`，凭证卷文件 0600、所有者为网关 Node 用户；只使用明确授权的会话。
4. 在 `canvas/` 构建 `backend/Dockerfile.fg`、`Dockerfile` 和 `yingce-agent/Dockerfile`，传 `BUILD_VERSION=v1.2.0` 与公司提交 SHA。
5. 备份并核验第六任务空闲，再仅替换第六后端、前端和网关；Nginx 检查后热加载。验收版本、NAS、账单状态，以及原应用镜像与启动时间未变。

主分支推送与运行服务更新分别处理。2026-10-02 仅发布第六服务，并使用平行入口容器处理 `/workspace`；原应用保留 1.1.2 镜像及启动时间。自动部署当前因原主机保留独立 Nginx 配置而拒绝更新，不能以“只改第六源代码”为理由直接重建原服务。正式全平台更新需另行安排；本次隔离路由与回退方式见 `OPERATIONS.md`。

## 独立模式与账号迁移

本节交付显式 opt-in 的本地候选配置、构建 ARG 与离线验收说明，不代表已完成 Next 主站退役。按用户追加要求已启动隔离本地实例并实际验收，2026-11-06 完成本地旧站用户迁入；未迁移生产账号、历史业务数据或旧会话，未迁移 Suno 的独立编排、凭证和状态，未构建应用镜像或验证生产入口。`FG_RUNTIME_TARGET` 脚本候选限制见下文，本轮未运行这些生产脚本。**本轮未授权生产切换、停服务或删数据**；生产切换必须另行取得明确授权。SupportBot、报表、监测、自动部署及其他调用方未完成解耦前，不可停止主站或任何生产守护进程。上文及 `OPERATIONS.md` 的历史发布步骤不构成本轮执行授权。

### 本地实际验收（2026-11-05）

隔离入口为 `http://127.0.0.1:43016/fg-six/`，真实运行 native Gateway、Nginx 静态 Web、源码编译的 Go backend/worker、新建 PostgreSQL 17 与 Redis 7.4，不启动旧 Next。仅绑定 loopback、使用本轮测试数据库与本地空 NAS 目录，不读取生产 env 或操作既有服务/卷。配置、随机测试凭据、日志和截图保存在 Git ignored 的 `canvas/.local/project-workbench-debug/`，`.native-e2e-current` 指向本轮目录，`runtime.json` 权限为 600。

真实 Chrome/CDP 已完成注册/登录、站内账户安全、改密与旧会话撤销、query/hash 深链恢复、画布编辑保存刷新、PNG 上传与签名预览、账号切换隔离、禁用/恢复及权限检查；独立 Go WebSocket 在改密后由心跳以 1008 撤销。修复并复测匿名 logo、旧入口尾斜杠 404 和 native 设置文案；Support 按钮只显示未接入且无旧站 HTTP/SSE。既有 Go 团队策略允许 superadmin 管理 user/member 的私人内容，不声称所有管理员跨用户访问都被拒绝；具体边界见 [数据隔离文档](canvas/docs/content/docs/backend/fg-workspace-privacy.mdx)。

真实迁移 CLI 在两个新建 synthetic 数据库间执行 dry-run/apply、幂等、alias 冲突整批拒绝、schema drift 拒绝，并通过 Go 验证 200-byte UTF-8 旧 scrypt 密码、错误密码和 disabled 账号；60/60 断言通过。修复后既有 Gateway 47/47、前端 29/29、native TypeScript/构建通过。命令及完整验证边界见仓库 `.planning/STATE.md`；仍未验收真实历史业务副本/恢复、完整 Compose、真实邮件/OAuth/SMS、AI 生成、NAS/guard、生产 TLS 及监测报表，P1 不放行。

### 本地旧用户迁入（2026-11-06）

按用户“只处理本地数据库，不要动生产环境”的要求，原本地 `fg_studio` 的 1 个管理员和当前 `.env.local` 所连 `fg_support_local` 的 2 个测试账号，均已迁入当前 `43016` 工作台；总用户数为 7，包含此前 4 个验收 fixture。原已停库仅只读复制并运行副本，当前本地源库只读导出，未启动/修改原容器或改写任一旧库，没有 SSH 或生产访问。

迁移前完整备份并实际恢复验证 164 张表；先在恢复库演练，再实际 dry-run/apply 和幂等 apply，后者均新增 0。迁移完成时，三个账号的 UUID、原邮箱、完整密码 hash、角色、创建时间与邮箱验证时间（源微秒精度）一致，既有 native 用户密码/状态不变；真实管理 API 200 且能读取三个旧用户。迁移过程中未重置密码，也未冒充已测试未知明文的旧密码登录。备份与私有连接配置在 `.native-e2e-current` 对应目录的 `local-user-migration-20261106-c5bdf6/`，迁移后的本地改密、账号复查状态及详细验证见 `.planning/STATE.md`。

### 显式选择完整 Compose

- 默认只用 `compose.yml`，`FG_AUTH_MODE` 默认为 `platform`，Dockerfile 的 `VITE_FG_AUTH_MODE` 也默认为 `platform`。该模式继续要求有效的 `FG_PLATFORM_PUBLIC_URL`，内部平台地址默认为 `http://fgai-app-app-1:3000`，外部网络仍为既有 `fg-studio`；不自动改变生产行为。
- 独立模式必须在原 `compose.yml` 后显式叠加 `compose.standalone.yml`。它固定 gateway 为 `FG_AUTH_MODE=native`，清空旧平台 URL，并将前端构建参数固定为 `VITE_FG_AUTH_MODE=native`。原生认证只使用 Go 认证与 `open_ai_canvas_session`，不得依赖旧平台 `/api/auth/session` 或复制 `fg_session`。
- 新配置完整复用 PostgreSQL、Redis、`migrate`、`yingce-agent`、backend、web、gateway、TLS、广告/创作服务，以及原有可选 `meilin` profile；不以精简编排替换这些服务，不移除任何服务网络连接或持久卷。项目名仍为 `fg-six-yingce`，五个持久卷的逻辑名与最终名称均不变；不要传其他 `-p`/项目名。
- 独立叠加配置保留 gateway 的 `default` 与外部 `fg-platform`（实际名 `fg-studio`）网络，不改成新隔离网络。原因不只是鉴权：另栈 `compose.media-test.yml` 的 `signed-media` 在 `fg-studio` 上通过 `http://fg-six-yingce-gateway-1:3010` 访问签名媒体。替换该网络会隔断其访问。独立模式仍要求既有共享网络，但网络存在不等于必须运行 Next 容器，也不要求任何旧平台 URL；离线环境需事先准备相应网络，本轮不创建或修改实际网络。
- 独立镜像使用单独的可覆盖候选变量：`CANVAS_STANDALONE_WEB_IMAGE` 默认 `fg-six-yingce-web-native:local`，`CANVAS_STANDALONE_BACKEND_IMAGE` 默认 `fg-six-yingce-backend-native:local`，`CANVAS_STANDALONE_GATEWAY_IMAGE` 默认 `fg-six-yingce-gateway-native:local`。backend 与 `migrate` 固定引用同一个 backend 候选变量；gateway 沿用既有 build 配置，但产物指向独立候选名。不得把这些变量设置为已发布的 platform/回滚 tag；默认 `:local` 可被后续候选构建覆盖，不应作为不可变回滚凭据。原 `CANVAS_WEB_IMAGE`、`CANVAS_BACKEND_IMAGE`、`CANVAS_GATEWAY_IMAGE` 保留用于默认配置/回滚，叠加后不作为这四个服务的构建输出名；前两项仍须提供以满足基础 Compose 的逐文件变量解析。
- 仅设置容器运行环境变量不能改变 Vite 产物；必须通过叠加配置的 `web.build` 重新构建或选用等价 ARG 构建的已验收 native 镜像。gateway 候选也必须包含本次 native 鉴权改动，不能仅给旧镜像改名。
- **后端也必须重新从本次源码构建，或使用已确认包含本次改动的镜像**：叠加配置的 `backend.build` 在 `canvas/` 上下文使用既有 `backend/Dockerfile.fg`，构建含 `backend/internal/auth/password_fg.go` 及 `auth.go` 调用改动的候选；其镜像由 backend 与 `migrate` 共用，`migrate` 不另设不同的构建产物。新增 FG scrypt hash 校验属于 Go 二进制，不会因更换 web/gateway 或设置环境变量而出现。不能假设旧镜像、官方固定 digest 或只重建 web 的 sourcebuild 已支持迁移后的密码。保留原镜像，记录新旧 tag/digest 与对应源码提交，并按下文密码分叉边界分别离线验证实际保留的密码可登录、普通/管理员/禁用状态不变；本轮不构建或替换运行镜像。
- 仓库默认 web/backend 仅引用镜像，独立叠加配置增加两者的源码构建入口；静态解析不会实际构建。部署机私有 sourcebuild 配置不在本轮核验范围内，如另有此类叠加文件，standalone 文件应最后加载，并核对最终 build 配置、三个 native 候选镜像名、backend/migrate 镜像一致性及网络，防止覆盖回 platform、覆盖原回滚 tag 或使用缺少 scrypt 支持的旧后端。

独立入口使用既有 `tls` 服务（`tls.conf` 直接代理 gateway），不依赖 Next 容器或主站 `entry.conf`。设置 `FG_SIX_PUBLIC_URL` 为真实独立 HTTPS origin，例如 `https://yingce.example.test:3016`，沿用 TLS 证书/密钥及端口配置；若使用额外反向代理，它应直接连接本服务 TLS/gateway，而非旧 Next 上游。`FG_EXTERNAL_PUBLIC_URL` 仅在另有可信入口时填写该入口的明确 origin，不填旧主站地址，不使用通配符；backend CORS 继续使用 `FG_SIX_PUBLIC_URL`。`FG_PLATFORM_URL`、`FG_PLATFORM_PUBLIC_URL` 在 native 模式不需要填写。

TLS 路由已按仓库配置静态核对：主入口的 `location /` 将原始 URI 直接转给 `gateway:3010`，无跳转旧主站的 `return`/`rewrite`；native gateway 放行 GET/HEAD `/`、`/login`、原生登录 API、外观与静态资源，再转给 `web:3000`。web 的 `nginx.conf` 对 `/` 返回 `index.html`，`/login` 由 SPA fallback 处理，`/api/` 转给 `backend:8080`，均无 Next 上游。TLS 的另一监听端口仍保留 `gateway:3020` 的既有退役工具入口，不能把它当作独立工作台入口。这里只核对源码配置，未对运行中的 Nginx、证书或 HTTP 响应作生产验收。

跨栈网络依赖按调用地址分别核对，不能只比较本 Compose 的 attachments：

| 调用方与实际服务地址 | 现有网络与独立模式要求 |
| --- | --- |
| gateway 音乐适配：`http://suno:3050` | `../suno/compose.yml` 将 Suno 接到外部 `fg-six-yingce_default`；gateway 的 `default` 正是该网络，保留项目名及 default 网络即可，不依赖 `fg-studio`。保留 Suno 自身状态卷、凭证挂载与部署，不重造 Suno 服务。 |
| `signed-media` → `http://fg-six-yingce-gateway-1:3010` | `compose.media-test.yml` 的独立媒体栈使用外部 `fg-studio`；保留 gateway 的 `fg-platform` 连接及原容器命名，不擅自迁移媒体栈。 |
| gateway → `web:3000`、`adcraft-api:8000`、`adcraft-web`、`creator-web`、可选 `meilin:5310`；backend → `yingce-agent:8081` | 使用现有 `fg-six-yingce_default`；完整 Compose 及 profile 不变。 |
| gateway → `/host-metrics/creator-runtimes.json`、`arcreel-runtimes.json` 中的 `10.208.0.0/12` 私有地址；工具 → `http://fg-gateway:3010` | `../opencreator/deploy/provision.py`、`../arcreel/deploy/provision.py` 在每用户私有 bridge 上为 gateway 配置 `fg-gateway` alias/固定地址。它们不是共享平台网络；更换 gateway 容器后必须由获准维护流程恢复既有私有连接，不能以本次静态 Compose 验证代替，也不能为此停止守护进程。退役路由仍由 gateway 策略决定，保留网络不等于重新开放这些工具。 |

独立模式仍要求原有数据库、Redis、Agent token、业务 secret、广告/创作镜像、NAS 挂载及 `.fg-studio-nas-ready` 标记、证书和私有目录；不得伪造 NAS 标记或指向宿主机空目录。既有账户工作区的额外私有网络也必须逐项清点保留，不能把移除平台鉴权误当作业务/存储全部解耦。

尚未迁移的边界：账号迁移器不导入旧平台 `groups` / `memberships`，旧分组与成员关系需独立核验和制定迁移方案，不能据账号导入成功认定已恢复。历史数据中的 Next 媒体 URL 仍待离线数据核验，必须检查引用、访问权限及旧站不可用时的可达性，不能仅凭新入口可用认定历史媒体已解耦。native Support UI 目前明确显示“未接入”，不启动 Support 轮询，也不向旧 Next 发起 Support 请求；这不是独立 Support 已迁移完成。生产默认 `platform` 模式及其原有 Support 行为不变。

静态核验只能使用自建临时假数据 env，不读取真实 `.env`；从本目录运行以下只读命令，不连接 Docker daemon、不构建或启动容器（`/tmp/yingce-standalone-check.env` 须事先填写全部 Compose 必需变量的假值）：

```bash
docker compose --env-file /tmp/yingce-standalone-check.env -f compose.yml config --format json
docker compose --env-file /tmp/yingce-standalone-check.env -f compose.yml -f compose.standalone.yml config --format json
```

默认模式检查需在临时 env 内填写假平台 origin；独立模式应再以不包含旧平台 URL 的临时 env 核验。检查服务清单、项目名、持久卷、gateway 模式、web 构建 ARG 和网络解析结果一致，且没有 Next 服务依赖。运行验收另在授权的离线副本完成：独立 origin 的 `/login` 应显示原生登录并完成原生会话登录/退出，不能跳转主站；验证共享资源、项目归属、管理员与普通/禁用账户权限。gateway `/health/live` 与 backend `/api/health/ready` 的 Compose 探针保持不依赖平台 URL；进程存活不等于业务、认证、NAS 和外部供应商全部就绪，应分别检查。

### FG_RUNTIME_TARGET 候选限制与监测 TLS

`FG_RUNTIME_TARGET=platform|native` 是脚本候选选择器，不等同于 gateway 的 `FG_AUTH_MODE` 或前端构建 ARG；未设置时仍为 `platform`。以下仅说明源码行为和未完成边界，不是生产启用说明，本轮未执行这些脚本：

1. `auto-deploy.sh` 的 native 分支立即以 **exit 78** 拒绝；不执行部署，也不回退 Next/旧平台部署或恢复流程。这是安全拒绝，不代表已经具备 native 自动发布能力。
2. `nas-supervisor.sh` 的 native 分支即使宿主 NAS 标记及权限探测成功，也保留 storage guard，并报告 **`native-recovery-required`**；不能视为 native 容器存储恢复成功。**尚未验证 Go backend 消费该 guard 并阻断业务写入，该 native NAS 恢复候选不可生产使用**；不能通过清除 guard、伪造标记或停守护进程绕过此限制。
3. native 观测目前仅将事件保存在本地 **outbox**，flush 延后，不消费队列、不向 Next 投递，不能据入队成功认定监测事件已送达。它不替代既有日报/周报/月报或报表调度，也不构成停止原监测、报表及主站的授权。

native monitor 的 HTTPS 入口必须使用与证书 SAN 匹配且在运行主机可解析的域名，不能假设默认 `127.0.0.1` 在证书中。候选配置格式如下（占位符须替换，不在本轮执行探测）：

```text
FG_MONITOR_NATIVE_GATEWAY_URL=https://<匹配SAN域名>:3016
FG_MONITOR_NATIVE_WEB_URL=https://<匹配SAN域名>:3016/fg-six
```

gateway 探针请求该 origin 下的 `/health/live`、`/health/version`；web 探针请求上述 `/fg-six` 下的 `/.well-known/fg-runtime.json`，不是 Next 页面。私有 CA 需通过 **monitor 进程环境**传入 `CURL_CA_BUNDLE=/absolute/path/to/private-ca-bundle.pem`，仅在某个 `.env` 文件中填写不等于进程已获得该变量。CA bundle 只补充信任链，**不能解决证书主机名与 SAN 不匹配**；必须修正域名/证书，不使用 `-k` / `--insecure` 或其他跳过 TLS 校验的方式。证书、DNS、实际响应和 Go storage guard 的有效性均仍待另行授权的离线验收。

### 备份、账号迁移与回滚

1. 先备份并验证 FG 源库、Yingce 目标库、NAS 业务数据，以及旧镜像、origin、Compose/Nginx 配置；在隔离离线副本验证备份可恢复。不要对生产库直接试迁移。
2. 迁移入口为 `gateway/migrate-platform-accounts.mjs`，参数与安全校验以脚本 `--help` 为准。源连接用 `SOURCE_FG_DATABASE_URL`（仅 SELECT 权限），目标用 `TARGET_NATIVE_DATABASE_URL`，二者必须为不同数据库，凭证不进入文档、命令历史或 Git。默认只做 dry-run，只有明确传入 `--apply` 才写目标；源 FG 连接必须只读，目标写入使用事务。**本轮只授权上述本地账号迁入，禁止生产迁移**，也不提供会隐式执行写入的部署 hook。
3. 离线验收新旧密码 hash 兼容性；保留用户 ID、启用/禁用状态和管理员/普通成员权限，不扩大权限；核对项目、分组、账务及资源归属引用（旧 `groups` / `memberships` 不在账号迁移器导入范围内）。**工具保留目标账户既有的非空 native 密码，不覆盖为旧 FG 密码，因此不能保证该账户同时接受旧 FG 密码**；需分别核验保留 native 密码与导入 FG hash 的账户，不能笼统承诺“旧密码全部可用”。native 改密不回写 FG，两套密码此后可能分叉。若 hash 不兼容或身份映射冲突，应中止迁移而非重置成统一密码。旧 session 不迁移，用户须重新原生登录，并验证旧平台 session 不能冒用原生会话。
4. 仅在备份、迁移 dry-run、离线 apply/恢复、权限及独立入口验收全部通过后，再申请单独的生产切换授权。SupportBot/报表/监测等遗留依赖逐项验收，未完成前保留主站和现有守护任务运行。
5. 回滚仅恢复原 platform 镜像与入口/Compose 配置，并按需从已验证备份恢复数据；不删除卷、不清库、不清 NAS、不改变项目名。**配置切回旧站不会把 native 新密码同步到 FG**，不能据入口恢复认定密码也已恢复；须独立离线验证旧站密码、已发生 native 改密的账户及备份恢复后的登录/恢复方案，明确两边密码状态和恢复点，不能临时覆盖密码或假设反向同步。配置切回本身也属于生产变更，须另行授权；本轮不执行任何停服或销毁操作。
