# FG Studio 第六板块 · 1.2.17

`canvas/` 保存画布源码和 FG 定制；`gateway/` 负责登录鉴权、故事立项、人民币报价与账单核销。默认仍使用平台登录；本地可选原生登录入口见[独立模式与账号迁移](#独立模式与账号迁移)。公司更新见根目录 `CHANGELOG.md`。

当前生产守护范围以 2026-11-17 用户确认为准：只有 **NAS 和隧道**；旧主站报表调度已移除，不需要迁移或恢复。下文 service-monitor、auto-deploy、观测与报表相关实现说明是历史/可选能力，不表示当前生产运行或上线必须启用；不以旧调度入口缺失或 native auto-deploy exit 78 阻塞上线。实际发布版本、NAS/隧道、业务数据/媒体、入口切换与回滚仍需验收，详见仓库 `.planning/STATE.md`。既有生产守护保护规则及授权边界不变。

## 版本与隔离

2026-11-17 按新增的生产只读授权核实：NAS/隧道当前状态正常，18 个历史媒体样本的宿主/容器读取一致；旧主站实际运行版本与 checkout 不同。发现现行 NAS supervisor、隧道旧 storage 路径及旧工程媒体引用仍依赖旧 app，不能直接停旧主站或宣布切换完成。未修改生产；详细版本身份、计数、证据及剩余门槛只记录在根 `.planning/STATE.md` 的生产只读核验专节。

同日继续验收发现原生项目预算准入亦硬依赖退役广告表，已按表实际存在性读取预算，历史上限与权限保留；真实库15/15、既有专项29/29、Gateway原gate 230 pass/0 fail/1既有skip。最新本地候选 `fg-main-acceptance-gateway:a441-20261117-budget` 包含下述finance修复，独立归档重载39/39；运行更新及pin要求见STATE最新预算专节。未调用模型，不等同实际供应商生成通过。

2026-11-17 本地迁移补验修复制作费用页因退役广告表缺失返回400的问题；无表时不再JOIN，有历史表时保留原权限/归属。既有定向测试15/15、Gateway原gate 230 pass/0 fail/1既有skip、真实库对照18/18、本地Gateway新→旧→新切换40/40、素材生命周期与隔离26/26。九镜像与该轮finance Gateway归档重载分别229/229、39/39；只证明本任务本地候选留存和回切，不代表生产历史版本/密码回退。后续budget镜像已替代该轮finance运行版本，最新身份与本地Compose的显式image/pin要求见 `.planning/STATE.md` 最新预算专节；生产NAS/隧道、历史数据与切流门槛未放行。

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

`maintain-host.py` 默认 platform 路径检查 NAS 真实读写，挂载失效暂停后端，避免写宿主机空目录。显式 `FG_RUNTIME_TARGET=native` 的候选路径只做受 guard 保护的原生数据库备份，不进入旧 stop/start/rebind/provision；未显式切换却发现 native Gateway 时拒绝旧维护流程。native 备份同时验证 `pg_restore --list`、完整数据解码 `pg_restore --file=/dev/null` 与读回摘要；仅 TOC 可读仍可能是尾部截断的损坏归档，不能签字通过。隔离本地备份已恢复到新库，不代表生产/NAS 素材停机灾难恢复演练通过。

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

本节交付显式 opt-in 的本地候选配置、构建 ARG 与离线验收说明，不代表已完成 Next 主站退役。按用户追加要求已启动隔离本地实例并实际验收，2026-11-06 完成本地旧站用户迁入；未迁移生产账号、历史业务数据或旧会话，未迁移 Suno 的独立编排、凭证和状态，已完成本任务隔离 native Compose 构建及本地 HTTPS/WSS 验收，未验证生产入口。`FG_RUNTIME_TARGET` 脚本候选限制见下文，本轮未运行这些生产脚本。**本轮未授权生产切换、停服务或删数据**；生产切换必须另行取得明确授权。SupportBot、报表、监测、自动部署及其他调用方未完成解耦前，不可停止主站或任何生产守护进程。上文及 `OPERATIONS.md` 的历史发布步骤不构成本轮执行授权。

### 本地实际验收（2026-11-05）

隔离入口为 `http://127.0.0.1:43016/fg-six/`，真实运行 native Gateway、Nginx 静态 Web、源码编译的 Go backend/worker、新建 PostgreSQL 17 与 Redis 7.4，不启动旧 Next。仅绑定 loopback、使用本轮测试数据库与本地空 NAS 目录，不读取生产 env 或操作既有服务/卷。配置、随机测试凭据、日志和截图保存在 Git ignored 的 `canvas/.local/project-workbench-debug/`，`.native-e2e-current` 指向本轮目录，`runtime.json` 权限为 600。

真实 Chrome/CDP 已完成注册/登录、站内账户安全、改密与旧会话撤销、query/hash 深链恢复、画布编辑保存刷新、PNG 上传与签名预览、账号切换隔离、禁用/恢复及权限检查；独立 Go WebSocket 在改密后由心跳以 1008 撤销。修复并复测匿名 logo、旧入口尾斜杠 404 和 native 设置文案；Support 按钮只显示未接入且无旧站 HTTP/SSE。既有 Go 团队策略允许 superadmin 管理 user/member 的私人内容，不声称所有管理员跨用户访问都被拒绝；具体边界见 [数据隔离文档](canvas/docs/content/docs/backend/fg-workspace-privacy.mdx)。

真实迁移 CLI 在两个新建 synthetic 数据库间执行 dry-run/apply、幂等、alias 冲突整批拒绝、schema drift 拒绝，并通过 Go 验证 200-byte UTF-8 旧 scrypt 密码、错误密码和 disabled 账号；60/60 断言通过。修复后既有 Gateway 47/47、前端 29/29、native TypeScript/构建通过。命令及完整验证边界见仓库 `.planning/STATE.md`；隔离完整 Compose 与 HTTPS/WSS、真实浏览器画布保存/断网补传已通过（证据见 `.planning/STATE.md`）；仍未验收真实历史业务副本/恢复、真实邮件/OAuth/SMS、AI 生成、NAS/guard、生产 TLS 及监测报表，P1 不放行。

### 本地旧用户迁入（2026-11-06）

按用户“只处理本地数据库，不要动生产环境”的要求，原本地 `fg_studio` 的 1 个管理员和当前 `.env.local` 所连 `fg_support_local` 的 2 个测试账号，均已迁入当前 `43016` 工作台；总用户数为 7，包含此前 4 个验收 fixture。原已停库仅只读复制并运行副本，当前本地源库只读导出，未启动/修改原容器或改写任一旧库，没有 SSH 或生产访问。

迁移前完整备份并实际恢复验证 164 张表；先在恢复库演练，再实际 dry-run/apply 和幂等 apply，后者均新增 0。迁移完成时，三个账号的 UUID、原邮箱、完整密码 hash、角色、创建时间与邮箱验证时间（源微秒精度）一致，既有 native 用户密码/状态不变；真实管理 API 200 且能读取三个旧用户。迁移过程中未重置密码，也未冒充已测试未知明文的旧密码登录。备份与私有连接配置在 `.native-e2e-current` 对应目录的 `local-user-migration-20261106-c5bdf6/`，迁移后的本地改密、账号复查状态及详细验证见 `.planning/STATE.md`。

### 显式选择完整 Compose

- 默认只用 `compose.yml`，`FG_AUTH_MODE` 默认为 `platform`，Dockerfile 的 `VITE_FG_AUTH_MODE` 也默认为 `platform`。该模式继续要求有效的 `FG_PLATFORM_PUBLIC_URL`，内部平台地址默认为 `http://fgai-app-app-1:3000`，外部网络仍为既有 `fg-studio`；不自动改变生产行为。
- 独立模式必须在原 `compose.yml` 后显式叠加 `compose.standalone.yml`。它固定 gateway 为 `FG_AUTH_MODE=native`，清空旧平台 URL，并将前端构建参数固定为 `VITE_FG_AUTH_MODE=native`。原生认证只使用 Go 认证与 `open_ai_canvas_session`，不得依赖旧平台 `/api/auth/session` 或复制 `fg_session`。
- standalone 必须显式设置 `FG_NAS_STATE_DIR` 为既有 NAS supervisor 状态目录（宿主机为 `$HOME/Library/Application Support/fg-studio-nas-state`；必须预先存在，不创建空目录冒充正常状态）。Backend/Gateway 以只读 bind 挂到 `/run/fg-nas`，固定 `CANVAS_NAS_GUARD_DIR=/run/fg-nas`；`disabled` 存在（包括目录/悬空符号链接）、目录无效/不可访问时 fail closed。Go 的 ready 返回 503，live、账号恢复、登录页外观及静态影片仍可用；Gateway 保护业务 HTTP 与新 WSS，Go 保护 API、短代理及本地资源/归档/暂存等入口，生成/删除/补传领取暂停；领取后尚未执行的暂停按 owner 栅栏退回，不消耗本次 attempt。默认 platform 未设置新变量时保持原行为。
- native supervisor 候选从其 env 文件读取 `FG_NAS_STATE_DIR`（显式进程变量优先，与 Compose 相同），拒绝缺失、相对路径、符号链接或不可访问目录，不再向未挂入容器的固定目录写守卫。默认仍检查 `fg-six-yingce` 项目的 backend/gateway；只接受各一个 running 容器，并核对 Compose labels、native/guard 环境、只读 guard bind、media/root bind、媒体标记身份及 backend ready；容器向既有稳定探针写入随机 nonce，宿主须读回同一 nonce，避免旧 bind 上的固定标记造成假健康。只有无 guard、无待恢复标记且全链探测成功的健康轮次保持开放，不周期性先封禁再恢复；巡检仅使用 Docker ps/inspect/exec，不重建容器，也不访问 Next。守卫写入不跟随符号链接、不截断原内容，不会阻塞在 FIFO；异常仍保留恢复标记。
- guard 只能由获准的宿主恢复流程解除，不能在容器内删除或将 ready marker 当作解除条件。一旦已有 guard/recovery-pending 或探测失败，native supervisor 仍保留保护，不自动解除或重建；真实 SMB 重挂、容器 bind 失效恢复及在途操作恢复未验收。本地 fixture 的健康巡检及正常文件 guard 清除后的 HTTP/队列恢复不等于真实 NAS 恢复，不能据此启用生产 native supervisor。回退保持原镜像、原编排及受保护任务运行，不以移除 guard 挂载绕过故障；测试边界和最终 gate 结果见 `.planning/STATE.md`。
- 本地异常类型演练中曾出现：宿主 `disabled` 已不存在、容器目录枚举为空，但容器 `lstat` 仍返回旧符号链接；正常文件重建再删除也未恢复。检查持续拒绝业务，未改为更宽松的存在性判断。仅隔离候选更换测试状态目录并重建其 Backend/Gateway 后恢复；这不是生产修复流程，也不能作为真实 NAS 自动恢复通过的证据。
- `maintain-host.py` 的 native 候选从自身 `.env`（显式进程变量优先）读取同一组 NAS/guard 路径。先核验现有三项服务的 labels/挂载及 Backend 与 PostgreSQL 的库身份匹配，再要求 ready/guard/probe 通过；通过无网络、只读根文件系统、只读 guard 的临时 storage worker 保存日备份并读回。native probe 使用稳定文件；异常 guard/备份链接拒绝，输入读取期间触发 guard 后不继续写入；已有备份需读回执行 `pg_restore --list` 及 `--file=/dev/null` 完整解码，不只凭存在或目录可读签字。guard 激活时遗留的隐藏暂存文件保留待恢复核验，不自动删 NAS 数据。该路径不重建容器、不重启守护任务、不恢复退役运行环境；本地原生库备份已实际恢复 177 张表，最新显式独立库验收另见下文；生产历史库与 NAS 素材完整恢复仍待各自验收。
- 若 Support/观测独立库也位于同一项目 PostgreSQL，可在维护进程环境显式设置 `FG_NATIVE_AUX_BACKUP_SERVICES=support-web,observability`（可只选一项；不是自动读取 `.env` 的开关）。先逐项核验 running sidecar 的 project/service labels、DATABASE_URL 和实际网络：仅接受共同网络的 `postgres:5432`，或与该精确 PostgreSQL 容器共享 network namespace 的 loopback；拒绝远程库、不同数据库用户、连接目标 query 覆盖、主业务库别名及两个服务重复指向同一库。不改写 sidecar 的连接配置，不把空库或主库备份冒充另一独立库。未设置时保留原主库备份行为，**不代表已经覆盖独立库**；远程历史观测库须单独提供并演练备份方案。
- 独立库备份仍复用同一个 guarded storage helper，路径为 `yingce/backups/database/<service>/<database>/<UTC日期>.dump`，与原主库 `<UTC日期>.dump` 隔离；新文件 0600、原字节读回核对，已有文件完整解码验证但不覆盖。服务名/库名严格限界、目录及文件链接拒绝、guard 激活则停止写入；三个库分别取 PostgreSQL 一致性快照，**不是跨库原子恢复点**。没有新增调度器、启动生产维护任务、自动清理旧备份或提供 drop/clean 式恢复；恢复须在新隔离库先验，生产配置与恢复另行授权。
- 本任务独立库本地验收 77/77：实际新库恢复 Support 4 表与观测 6 表，所有行数/全行 digest、列/约束/索引和序列状态一致；原 native 维护 70/70、主库恢复完整性 10/10 对最终源码回归通过。七个原容器未重建/重启，未运行生产任务或真实模型。详细命令、fixture 来源及失败证据见 STATE 最新备份专节；不以这些 synthetic 数据签认生产历史库或 SMB 素材恢复。
- native 客户端 IP 必须采用显式可信代理链：公开 `tls.conf` 重置 X-Forwarded-For 为连接来源，丢弃 X-Real-IP/Forwarded；`FG_NATIVE_TRUSTED_PROXY_CIDRS` 仅填写直连 Gateway 的 TLS 代理地址/CIDR，Gateway 只从受信 peer 接受单个有效来源 IP，不接受逗号链。`CANVAS_NATIVE_TRUSTED_PROXIES` 注入后端的 `CANVAS_TRUSTED_PROXIES`，仅填写后端前方实际 Web/Gateway 地址（Web 会追加 Gateway hop），Go 只解析受信 XFF 链；不得信任客户端网络或使用 `/0`。未填写时 native 不信任来源头，会使用代理自身 IP，不能据此认为按用户来源限流已验收。原 platform 未配置新后端变量时保持既有行为。
- 可信地址须在目标环境核对实际连接拓扑，优先专用、稳定代理地址；重建容器后复核地址与配置，不能复制本任务临时 IP 或直接信任整个共享 Docker 网段。配置无效时进程启动失败，先修正配置再恢复；回退使用原镜像及原配置，清空新变量仅为安全禁用代理信任（会合并限流桶），不视为正常运行验收。上述检查不授权重启任何生产任务。
- 新配置完整复用 PostgreSQL、Redis、`migrate`、`yingce-agent`、backend、web、gateway、TLS、广告/创作服务，以及原有可选 `meilin` profile；不以精简编排替换这些服务，不移除任何服务网络连接或持久卷。项目名仍为 `fg-six-yingce`，五个持久卷的逻辑名与最终名称均不变；不要传其他 `-p`/项目名。
- 独立叠加配置保留 gateway 的 `default` 与外部 `fg-platform`（实际名 `fg-studio`）网络，不改成新隔离网络。原因不只是鉴权：另栈 `compose.media-test.yml` 的 `signed-media` 在 `fg-studio` 上通过 `http://fg-six-yingce-gateway-1:3010` 访问签名媒体。替换该网络会隔断其访问。独立模式仍要求既有共享网络，但网络存在不等于必须运行 Next 容器，也不要求任何旧平台 URL；离线环境需事先准备相应网络，本轮不创建或修改实际网络。
- 独立镜像使用单独的可覆盖候选变量：`CANVAS_STANDALONE_WEB_IMAGE` 默认 `fg-six-yingce-web-native:local`，`CANVAS_STANDALONE_BACKEND_IMAGE` 默认 `fg-six-yingce-backend-native:local`，`CANVAS_STANDALONE_GATEWAY_IMAGE` 默认 `fg-six-yingce-gateway-native:local`。backend 与 `migrate` 固定引用同一个 backend 候选变量；gateway 沿用既有 build 配置，但产物指向独立候选名。不得把这些变量设置为已发布的 platform/回滚 tag；默认 `:local` 可被后续候选构建覆盖，不应作为不可变回滚凭据。原 `CANVAS_WEB_IMAGE`、`CANVAS_BACKEND_IMAGE`、`CANVAS_GATEWAY_IMAGE` 保留用于默认配置/回滚，叠加后不作为这四个服务的构建输出名；前两项仍须提供以满足基础 Compose 的逐文件变量解析。
- 仅设置容器运行环境变量不能改变 Vite 产物；必须通过叠加配置的 `web.build` 重新构建或选用等价 ARG 构建的已验收 native 镜像。gateway 候选也必须包含本次 native 鉴权改动，不能仅给旧镜像改名。
- **后端也必须重新从本次源码构建，或使用已确认包含本次改动的镜像**：叠加配置的 `backend.build` 在 `canvas/` 上下文使用既有 `backend/Dockerfile.fg`，构建含 `backend/internal/auth/password_fg.go` 及 `auth.go` 调用改动的候选；其镜像由 backend 与 `migrate` 共用，`migrate` 不另设不同的构建产物。新增 FG scrypt hash 校验属于 Go 二进制，不会因更换 web/gateway 或设置环境变量而出现。不能假设旧镜像、官方固定 digest 或只重建 web 的 sourcebuild 已支持迁移后的密码。保留原镜像，记录新旧 tag/digest 与对应源码提交，并按下文密码分叉边界分别离线验证实际保留的密码可登录、普通/管理员/禁用状态不变；生产镜像尚未替换；本地隔离候选已完整构建并验收，实际结果见仓库 `.planning/STATE.md`。
- 仓库默认 web/backend 仅引用镜像，独立叠加配置增加两者的源码构建入口；静态解析不会实际构建。部署机私有 sourcebuild 配置不在本轮核验范围内，如另有此类叠加文件，standalone 文件应最后加载，并核对最终 build 配置、三个 native 候选镜像名、backend/migrate 镜像一致性及网络，防止覆盖回 platform、覆盖原回滚 tag 或使用缺少 scrypt 支持的旧后端。

独立入口使用既有 `tls` 服务（`tls.conf` 直接代理 gateway），不依赖 Next 容器或主站 `entry.conf`。设置 `FG_SIX_PUBLIC_URL` 为真实独立 HTTPS origin，例如 `https://yingce.example.test:3016`，沿用 TLS 证书/密钥及端口配置；若使用额外反向代理，它应直接连接本服务 TLS/gateway，而非旧 Next 上游。`FG_EXTERNAL_PUBLIC_URL` 仅在另有可信入口时填写该入口的明确 origin，不填旧主站地址，不使用通配符；backend CORS 继续使用 `FG_SIX_PUBLIC_URL`。`FG_PLATFORM_URL`、`FG_PLATFORM_PUBLIC_URL` 在 native 模式不需要填写。

TLS 路由已按仓库配置静态核对：主入口的 `location /` 将原始 URI 直接转给 `gateway:3010`，无跳转旧主站的 `return`/`rewrite`；native gateway 放行 GET/HEAD `/`、`/login`、原生登录 API、外观与静态资源，再转给 `web:3000`。web 的 `nginx.conf` 对 `/` 返回 `index.html`，`/login` 由 SPA fallback 处理，`/api/` 转给 `backend:8080`，均无 Next 上游。TLS 的另一监听端口仍保留 `gateway:3020` 的既有退役工具入口，不能把它当作独立工作台入口。这里只核对源码配置，未对运行中的 Nginx、证书或 HTTP 响应作生产验收。

原生监测与发布身份：`scripts/service-monitor.sh` 在 `FG_RUNTIME_TARGET=native` 下分别检查 Gateway `/health/live`、`/health/version` 与 Web `/.well-known/fg-runtime.json`。`FG_MONITOR_NATIVE_GATEWAY_URL`、`FG_MONITOR_NATIVE_WEB_URL` 显式指向实际入口；HTTPS 必须通过可信 CA 校验，不用 `-k` 绕过。Backend 的公开 `/api/health/ready` 仍需认证，监测不放宽该接口，而是按 `FG_MONITOR_NATIVE_COMPOSE_PROJECT`（默认 `fg-six-yingce`）选择唯一 Backend，核对 Compose labels、运行状态、native guard 配置及只读 bind 后，通过该容器 loopback 读取 ready，验证 database/runtime/schema/NAS 与版本。只执行只读探针，不启动、停止或重建服务，不使用旧站 Compose helper。

在监测进程环境中另设 `FG_MONITOR_NATIVE_EXPECTED_VERSION` 与 `FG_MONITOR_NATIVE_EXPECTED_COMMIT`（完整 40 位 commit），值必须来自批准的目标 release，不能从运行服务反填为“期望”。新增 `yingce-release` 状态与三个服务的健康状态分开：身份未配置或匹配但仍为 dirty/development 候选时为 `unknown`；三者版本/commit 不一致、与期望不符或任一探针失败时为 `unhealthy`；三者均为 production、dirty=false、版本/完整 commit 匹配批准目标且 Backend ready 才为 `healthy`。这只是运行身份/就绪门槛，不代表真实历史数据、外部渠道、上线切流或回滚已验收；native auto-deploy 仍保持未实现时拒绝执行，不能把监测绿灯当部署完成。

跨栈网络依赖按调用地址分别核对，不能只比较本 Compose 的 attachments：

| 调用方与实际服务地址 | 现有网络与独立模式要求 |
| --- | --- |
| gateway 音乐适配：`http://suno:3050` | `../suno/compose.yml` 将 Suno 接到外部 `fg-six-yingce_default`；gateway 的 `default` 正是该网络，保留项目名及 default 网络即可，不依赖 `fg-studio`。保留 Suno 自身状态卷、凭证挂载与部署，不重造 Suno 服务。 |
| `signed-media` → `http://fg-six-yingce-gateway-1:3010` | `compose.media-test.yml` 的独立媒体栈使用外部 `fg-studio`；保留 gateway 的 `fg-platform` 连接及原容器命名，不擅自迁移媒体栈。 |
| gateway → `web:3000`、`adcraft-api:8000`、`adcraft-web`、`creator-web`、可选 `meilin:5310`；backend → `yingce-agent:8081` | 使用现有 `fg-six-yingce_default`；完整 Compose 及 profile 不变。 |
| gateway → `/host-metrics/creator-runtimes.json`、`arcreel-runtimes.json` 中的 `10.208.0.0/12` 私有地址；工具 → `http://fg-gateway:3010` | `../opencreator/deploy/provision.py`、`../arcreel/deploy/provision.py` 在每用户私有 bridge 上为 gateway 配置 `fg-gateway` alias/固定地址。它们不是共享平台网络；更换 gateway 容器后必须由获准维护流程恢复既有私有连接，不能以本次静态 Compose 验证代替，也不能为此停止守护进程。退役路由仍由 gateway 策略决定，保留网络不等于重新开放这些工具。 |

独立模式仍要求原有数据库、Redis、Agent token、业务 secret、广告/创作镜像、NAS 挂载及 `.fg-studio-nas-ready` 标记、证书和私有目录；不得伪造 NAS 标记或指向宿主机空目录。既有账户工作区的额外私有网络也必须逐项清点保留，不能把移除平台鉴权误当作业务/存储全部解耦。

尚未迁移的边界：账号迁移器不导入旧平台 `groups` / `memberships`，旧分组与成员关系需独立核验和制定迁移方案，不能据账号导入成功认定已恢复。历史数据中的 Next 媒体 URL 仍待离线数据核验，必须检查引用、访问权限及旧站不可用时的可达性，不能仅凭新入口可用认定历史媒体已解耦。native Support 未配置时仍关闭，不轮询、不向旧 Next 发请求；显式接入的候选及已验范围见下节，不等于真实 worker 已完成迁移。生产默认 `platform` 模式及其原有 Support 行为不变。

### 独立 Support 网页接入候选

`compose.standalone.yml` 增加显式 `support-web` profile；默认不运行、不自动迁移数据库或启动 worker。该服务只提供原问题队列的 HTTP/SSE 接入，不含 Next runtime，不替代独立 worker。Gateway `/api/support-bot/status` 只有在私网接入健康且启用时才解锁 UI，所有网页请求仍先经 Go session 与 Origin 校验。SSE 每15秒重新检查授权它的 Go session，失效或核验身份改变时断开；ExpectedUser 仅防陈旧页面串号，不是身份凭据。

启用前必须分别配置并核验：

- `SUPPORT_BOT_DATABASE_URL` 指向原助手队列所属库，`SUPPORT_BOT_ENVIRONMENT=local|production` 与库级 `fg.support_environment` 标记匹配；沿用根 README“问题助手”的既有 006 日志表及 016–021 增量 schema，不创建替代历史队列、不重映射 owner，不由 HTTP 服务自动执行 DDL。local 模式仅允许 localhost，跨容器测试应使用隔离 namespace，不能通过假称 production 绕过环境保护。
- `SUPPORT_BOT_WEB_URL` 为 Gateway 可访问的私网 HTTP(S) origin，例如 `http://support-web:3012`，不含用户名、密码、额外 path/query/hash。`SUPPORT_BOT_WEB_RELAY_TOKEN` 为至少32字符的独立密钥，只注入 Gateway 与接入服务；它不同于 `SUPPORT_BOT_NATIVE_READ_TOKEN`，不得给浏览器或替代原只读取证凭据。Compose 不发布该服务宿主端口。
- 设置独立 `CANVAS_STANDALONE_SUPPORT_WEB_IMAGE`、`SUPPORT_BOT_WEB_DEPLOYMENT_VERSION`，保留旧镜像/队列/worker 回退产物；显式 `--profile support-web` 构建与启动候选。`SUPPORT_BOT_ENABLED=true` 只能在管理员确认消费方/数据源准备好后启用，`SUPPORT_BOT_SEND_ENABLED` 固定 false，不因此启用飞书外发。health ready 只验证接入/数据库，不签认 worker/模型就绪；worker 的源码、环境、产品取证及运行版本必须单独验收。

2026-11-17 本地隔离库 core 22 项、真实 CA 验证 HTTPS 29 项、private auth/大正文边界、readiness fail-closed 及 Chrome 入队→刷新→取消→刷新恢复通过；真实32hex owner 未转换，跨账号/伪造身份拒绝，退出后断 SSE，chunked 超限返回实际 413。反馈只使用 synthetic completed fixture，没有启动 worker 或调用模型；生产 worker、历史队列与真实诊断仍未验。构建与证据见仓库 `.planning/STATE.md`。回退时只撤销新 Gateway URL/token/profile 配置并恢复候选前镜像，保持队列和原 worker 不动；不要删除历史任务、停生产守护进程或把缺省关闭当永久退役。

静态核验只能使用自建临时假数据 env，不读取真实 `.env`；从本目录运行以下只读命令，不连接 Docker daemon、不构建或启动容器（`/tmp/yingce-standalone-check.env` 须事先填写全部 Compose 必需变量的假值）：

```bash
docker compose --env-file /tmp/yingce-standalone-check.env -f compose.yml config --format json
docker compose --env-file /tmp/yingce-standalone-check.env -f compose.yml -f compose.standalone.yml config --format json
```

默认模式检查需在临时 env 内填写假平台 origin；独立模式应再以不包含旧平台 URL 的临时 env 核验。检查服务清单、项目名、持久卷、gateway 模式、web 构建 ARG 和网络解析结果一致，且没有 Next 服务依赖。运行验收另在授权的离线副本完成：独立 origin 的 `/login` 应显示原生登录并完成原生会话登录/退出，不能跳转主站；验证共享资源、项目归属、管理员与普通/禁用账户权限。gateway `/health/live` 与 backend `/api/health/ready` 的 Compose 探针保持不依赖平台 URL；进程存活不等于业务、认证、NAS 和外部供应商全部就绪，应分别检查。

### FG_RUNTIME_TARGET 候选限制与监测 TLS

`FG_RUNTIME_TARGET=platform|native` 是脚本候选选择器，不等同于 gateway 的 `FG_AUTH_MODE` 或前端构建 ARG；未设置时仍为 `platform`。以下仅说明源码行为和未完成边界，不是生产启用说明；本轮只在任务隔离环境调用原始函数与独立候选服务，没有运行生产任务或完整守护脚本：

1. `auto-deploy.sh` 的 native 分支立即以 **exit 78** 拒绝；不执行部署，也不回退 Next/旧平台部署或恢复流程。这是安全拒绝，不代表已经具备 native 自动发布能力。
2. `nas-supervisor.sh` 的 native 健康巡检在没有既有 guard/pending 时，核对实际容器身份、guard/media/root bind、跨视图 nonce 回执与 Backend ready 后保持开放；Go/Gateway 的普通文件 guard 消费已经在本地验证。但已有保护状态或任何异常仍不自动解除/重建，异常 bind 恢复与真实 SMB/在途恢复仍未关闭；不能通过清除 guard、伪造标记或停守护进程绕过限制。完整边界见仓库 STATE 的 NAS 专节。
3. native 观测先持久化本地 **outbox**；未显式配置独立接收端时仍 exit 75 留队，不回退 Next。已补下述可选 native intake，只有原 PostgreSQL 事务提交且接收端返回匹配 eventKey 的 native durable ack 才移除事件，不能据入队或 HTTP 2xx 单独认定已送达。它不替代既有日报/周报/月报或报表调度，也不构成停止原监测、报表及主站的授权。

### 独立观测接收与持久确认

完整 Compose 的 standalone 叠加文件新增可选 `observability` profile，默认不启动。独立镜像由 `production-lab/meilin/observability.Dockerfile` 从既有依赖和原始监测/错误 HTTP core 构建，不包含 Next runtime、不新增队列或 schema。旧 Next route 仍复用相同 core，保持原平台协议；native 服务只接收 `/api/observability/{monitor-events,error-events}`，鉴权使用独立密钥，不借用用户会话。

- `OBSERVABILITY_DATABASE_URL` 必须显式指向保留历史观测与报表的数据库，确认它与原数据、网络及备份对应；**不要把 native Go 数据库、空库或本任务 fixture 当历史报表库**。服务只读检查既有 `observability_service_events`、`observability_error_events`、`report_runs` 的必需列，不建库建表、不迁移或清空数据；schema 缺失则启动失败。真实生产历史库和访问拓扑仍待另行只读核验。
- 配置独立的 `FG_NATIVE_OBSERVABILITY_SECRET`（至少 32 字符），不要复用 SESSION_SECRET；Compose 只向该接收端注入为 `FG_OBSERVABILITY_SECRET`。镜像变量为 `CANVAS_STANDALONE_OBSERVABILITY_IMAGE`，默认候选 tag 不能当不可变回滚身份；记录实际 image ID。显式 `--profile observability` 构建/启动候选，不因此重建其余服务。默认只发布 `127.0.0.1:${FG_OBSERVABILITY_HOST_PORT:-3013}`，内部监听 3013；隔离网络必须核对真实连通性，不为此修改已有服务的网络或信任范围。
- 在 native 监测进程环境中显式设置 `FG_MONITOR_NATIVE_OBSERVABILITY_URL=http://127.0.0.1:<实际宿主端口>` 和相同独立密钥。native flush 只允许显式 loopback HTTP origin，禁用 curlrc/环境代理干预；不从旧平台 URL 或凭据推导目标。接收端 `/health/ready`、能力 GET 与 POST 均需独立密钥，不能公开代理这些内部接口。
- 能力协议须同时返回 native target、heartbeat=1、durable ack=1；不匹配时在轮转前 exit 75，原队列不变。POST 必须提供稳定 eventKey，正文上限 512 KiB，为原 256 KiB 有界日志及宿主生产端的额外 envelope 保留空间；错误永久拒绝时保留原字节并隔离原因。鉴权/限流/服务异常、无效或错 key 的 2xx ack 留队重试，仍保留跨轮类别公平性。确认期间文件被替换时不删除新文件。接收端保留原采样时间、脱敏、eventKey 幂等与迟到事件导致报表失效的事务语义；DB 写入或报表失效失败不会发出成功确认。
- 旧报表 `user_id` 是 UUID；native 32hex 错误身份原样保存在 `metadata.nativeUserId`，不转成另一 UUID，不因此声称旧报表已能聚合所有 native 业务/账单。该 intake 的本地真实镜像/PG/outbox 与独立 fixture 库备份恢复证据见 STATE；实际报表调度、原生业务数据聚合、告警外发、生产历史库及其真实备份/恢复仍需单独验收。回退保留本地 outbox、历史数据库和旧镜像，撤销显式 native sink 配置即恢复留队；不要为回退删除数据或停止任何生产守护任务。

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
4. 仅在备份、迁移 dry-run、离线 apply/恢复、权限及独立入口验收全部通过后，再申请单独的生产切换授权。按实际启用范围验收遗留依赖（如保留的 SupportBot）；已退役的报表调度与非当前运行的旧监测/自动部署守护不纳入必迁项。未获切换授权前不操作主站或当前 NAS/隧道守护任务。
5. 回滚仅恢复原 platform 镜像与入口/Compose 配置，并按需从已验证备份恢复数据；不删除卷、不清库、不清 NAS、不改变项目名。**配置切回旧站不会把 native 新密码同步到 FG**，不能据入口恢复认定密码也已恢复；须独立离线验证旧站密码、已发生 native 改密的账户及备份恢复后的登录/恢复方案，明确两边密码状态和恢复点，不能临时覆盖密码或假设反向同步。配置切回本身也属于生产变更，须另行授权；本轮不执行任何停服或销毁操作。
