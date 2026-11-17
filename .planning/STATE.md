# 当前状态

- 日期：2026-11-17（Asia/Shanghai）。
- 当前目标：按用户“持续验收直到能正式上线”的要求，在独立 worktree 反复修复、验收与回归，关闭本地可解决缺口；保留旧主站猫导演影片及沉浸式布局。不自动 commit/push，不部署、不调用付费模型。2026-11-17 新授权仅允许查看生产 NAS/隧道、部署版本及历史媒体引用；严禁编辑、修改、删除、关闭、移动等生产副作用，不扩展到账号、渠道或 Support 配置审计。
- 当前计划：`.planning/phases/main-site-retirement/PLAN.md`；独立助手既有发布记录与本次迁移验收分开保留。
- 范围纠正（2026-11-17 用户确认）：当前生产守护任务只有 **NAS 和隧道**；旧主站报表调度早已移除，不迁移、不恢复、不作为上线阻塞。旧 service-monitor、auto-deploy、独立助手 worker 的历史记录不能当作当前运行清单。已实现的可选观测/兼容代码保留，不据此扩张上线必需项。
- 执行状态：2026-11-17 获得上述针对性只读授权后，已通过 SSH alias `server` 完成生产只读核验；此前“完全没有生产访问授权”的阻塞已解除，不能继续沿用。确认 NAS/隧道当前可读与连接就绪，同时发现 NAS supervisor 和历史媒体仍依赖旧主站。目标未完成、未放行上线；没有后台验收任务，未部署或改变生产服务。
- 版本管理：用户随后明确授权提交并 push 当前 `codex/main-site-migration-acceptance` 分支的累计验收改动；该授权不包含部署、切流或修改生产。提交/远程同步身份以实际 Git 记录为准，不能据 push 成功把 `gaps_found` 改为上线通过；本页下方“未 commit/push”为各历史验收时点的记录。
- 当前状态：`gaps_found`。本地登录布局、认证/画布/资源/分享/会话链路、原 Backend Docker gate、隔离 HTTPS/WSS 与双来源限流/反伪造已通过；独立 Support HTTP/UI/owner 和 chunked 413 已验。最新补齐可选 native 独立观测与 durable outbox（72+6+4 项），以及显式选择的本项目 Support/观测独立库日备份和新库实际恢复（77 项；原维护 70 项与主库恢复完整性 10 项回归通过）。当前生产 NAS/隧道现状、部署身份及有界历史媒体只读核验已完成，发现实际旧 app 依赖；实际发布/回滚、历史数据迁移、SMB 故障恢复、native 守护/隧道适配及目标生产代理/切流仍待验。Support 若保留启用，其真实 worker/模型链路须另验，不能以 HTTP 入队代替。旧自动部署和已退役报表不再作为必需门槛。本次改动未 commit/push，未部署；独立助手 `3b07ab80` 的历史发布不代表本迁移候选已上线。

## 生产只读核验与当前上线门槛（2026-11-17）

- 授权边界：只读查看 NAS/隧道、部署版本与历史媒体引用。通过既有 SSH alias `server`，未执行生产仓库中的运维/健康修复脚本，未写探针、修改文件或数据库、重连 NAS、重启/停止容器或守护任务。数据库使用 `BEGIN TRANSACTION READ ONLY`、连接级 `default_transaction_read_only=on`、8 秒 statement timeout 与 1 秒 lock timeout；只返回必要元数据、URL 类型计数及脱敏文件摘要，不输出密码、Cookie、签名、正文或文件内容。
- **NAS 与隧道当前状态已核实，不再因“未授权访问”阻塞。** 15:08（Asia/Shanghai）NAS 为实际 SMB 挂载，既有 marker 符合 `fg-studio-media:v1`，NAS supervisor 已加载且上次退出码 0，disabled 不存在；cloudflared `/ready` 为 200、4 条 ready connections。只证明当前状态，未做写入、故障、重挂载或外网端到端演练。
- **实际版本与 checkout 不相同。** 生产 checkout 为 `2f042715f063f39c8eb893305730a063c4d167d0`，有既存 Nginx 配置修改；旧主站实际 `/api/version` 为 system `1.6.1`、deployment `deploy-20261111T050034Z-3e12517ed2cc`，与运行容器环境一致。影策 Web 的实际服务目录与镜像预置目录静态 metadata 均为 `1.7.1 / 2f042715... / dirty=false`。Nginx 根入口仍到旧 app，`/fg-six/` 到现有 Gateway，不能把 checkout 或该影策版本当成本 worktree 候选已上线。当前镜像/容器身份已有记录，但未验收旧版异机恢复或完整回滚。
- **阻塞一：已确认的旧主站运行依赖。** 实际 NAS supervisor 源码没有候选的 native runtime selector，仍含旧 app lifecycle；隧道实际 ingress 将 `/api/local/storage/content` 发到 `http://app:3000`，原生 public resource file 则到现有 Gateway。此授权下保持二者不动；直接移除旧 app 会留下生产依赖，不能以 NAS/隧道 healthy 代替迁移完成。未据其他历史 LaunchAgent 条目恢复或扩展必迁服务，报表继续按用户决定退役。
- **阻塞二：真实历史媒体确有旧 handler 引用。** 旧库 96 条 `creator_canvases.graph` 中，18 条含 `/api/local/storage/content`，54 条含 `/api/creator/canvas-assets/content`（两类可能重叠）；5 条 `creator_productions.state` 中 1 条含后者。不是仅根据仓内代码推断。若保留这些历史工程的媒体可用性，必须先完成受限且保持原签名/归属鉴权的读取方案或明确其退役范围；本轮不重写 URL、不发放签名、不添加任意 URL 代理，不默认把历史工程退役。
- 原生已查字段未发现上述三类旧 handler 字符串：118 个 canvas、81 个 snapshot、7,607 个 task input/result、6,934 个 asset payload、20 个 drama document、2 个 story snapshot、8 个 project topic snapshot；不扩展为所有表/外部副本无依赖。6 条 company asset 与 2,743 条 asset representation 的 resource 关联无孤儿；原生 resource 快照共 7,908 条（7,904 ready、4 failed），未修复/删除既有 failed 记录。旧库另有 7,777 条 creator asset storage key 与 2 条 project asset storage key，不据此宣称已导入原生。
- 真实 NAS 历史媒体有界抽样：旧素材 6 个、原生资源 12 个，宿主存在性和宿主/对应运行容器前 4 KiB SHA 比对均 **18/18**；12 个原生样本 size 与 DB 一致。原生实际映射为容器 `/data/yingce` → 宿主 `/Volumes/FgStudio/media/yingce`，不是 `/media/resources`。初次按错误 dataDir 推断得到的不存在记录保留为 `production-readonly-20261117-initial-mapping.json`，纠正为 inspect 的实际 env+最长 bind 后全部通过，不报告为生产丢失。不是全部 7,908 个文件的完整性或 Range/浏览器播放验证。
- **仍未放行。** 本轮关闭了当前状态/部署身份/部分真实媒体取证缺口，没有完成 clean release、账号/团队/密码分叉回退、已启用外部渠道及 Support 完整链路、历史 URL 读取方案、native NAS 守护切换或生产入口切流/回滚。它们未被本次只读授权覆盖，不能通过改生产、停旧站或用 synthetic 结果代替；不请求或执行任何生产停用。
- 复现：在既有 worktree，以 `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ControlMaster=no -o ConnectTimeout=15 server 'python3 -B -' < "$compose/production-readonly-probe.py"` 及 `production-media-documents.py` 执行（`compose` 为既有 ignored acceptance runtime 目录）；脱敏证据为 `evidence/production-readonly-20261117-final.json` 和 `production-media-documents-20261117.json`。主核验前后 8 个被查容器的 ID/image/StartedAt/RestartCount 不变；无生产变更命令。此次只改本地验收记录，不重复构建未改的应用。

## 只读授权前终审记录（2026-11-17，历史）

- 上轮为实质进展：修复项目预算准入、真实库15项、新镜像更新25项及归档39项完成，不是等待后台任务。本轮只做终审，不把继续重复相同本地测试当作生产验收进展。当前工作区仍为 `codex/main-site-migration-acceptance`；实际Gateway为已验证budget镜像且healthy，两处修复源码SHA与实际运行文件均一致；此前JSON证据仍有效，未重新运行整栈构建或调用模型。
- 本地代码/构建/数据库/HTTP/UI范围有直接证据；最新真实库15/15、更新25/25、归档39/39、浏览器finance200/console0不能证明生产NAS/隧道、真实数据或旧主站可退役。已有本地切换记录明确为隔离候选，不是生产切流。
- **阻塞一：真实运行与数据证据。** P1需要当前NAS/隧道配置和入口、真实历史用户/团队/媒体引用及旧URL依赖、当前发布身份/保留旧版产物、密码分叉及会话影响。现有环境与备份均为synthetic/local，仓内旧cloudflared/app配置不是当前生产状态。用户未提供真实脱敏配置/隔离业务副本，且明确禁止访问生产；无权通过SSH、浏览器生产页或后台接口自行补齐。必须取得针对性只读授权，或收到适合离线验收的真实脱敏配置与业务副本；只读检查也不能代替随后故障/切流演练。
- **阻塞二：正式发布与外部链路边界。** 当前dirty候选不能签认干净正式release；当前目标禁止自动commit/push及生产操作。实际启用的认证/邮件/SMS/OAuth/供应商与Support完整处理链路须由真实配置/启用范围确定，无相应凭据、范围确认或付费调用授权时不能补测或臆定关闭。报表已退役，不在此清单。正式发布/切流/生产写入/具体服务停止仍分别需要明确授权，本轮不请求或执行停用。
- 同一真实生产/数据/授权阻塞已连续三轮明确出现；前两轮仍有本地缺口可修，现已关闭这两处具体故障，下一项必要门槛依赖上述输入，不能靠多造synthetic fixture或重复绿灯代替。目标标记blocked等待输入，不缩小上线目标、不宣称完成；任务容器继续运行，所有生产任务保持不动。

## 持续验收：原生项目预算准入的退役表依赖（2026-11-17）

- 前轮完成财务修复和浏览器补验，属于实质进展。本轮沿同一退役表边界核对真实生成准入：Go `ReserveFGBudget` 在收费调用前访问 Gateway `/internal/fg/budget-admission`，`reserveBudget` 对所有有关联项目的 task 无条件 UNION `fg_adcraft_workspaces`。这意味着费用页恢复不等于原生项目已可生成；不通过调用付费模型验证。
- 在全新 PostgreSQL 恢复库 `fg_budget_acceptance_a441_61e49549`（显式 local marker）真实复现原函数 `42P01`，失败事务不写 reservation。修复 `gateway/fg-budgets.mjs`：仅对有项目的准入只读检查历史广告表，缺表时仅查原生故事预算；表存在时保留原 UNION、既有锁/权限/限额/定价。不补建退役表，不跳过预算，不改变 Go/HTTP 接口或授权逻辑。
- 原/新函数+真实库 **15/15**：native32原生项目及canvas父项目归属、成功保留有限报价、项目不足/未知价/月额度不足拒绝且不留reservation、外人task不获得项目归属、历史广告预算与原函数一致且不扩权、历史表存在时仍执行原生故事预算。所有写入仅在新恢复库，九个任务容器不变，模型调用0。首次harness把canvas列误写成name/data，依据实际schema改为title/payload_json；首次失败证据保留，没有改业务表迁就harness。
- 既有预算14项通过，与财务/个人费用/退役边界合跑 **29/29**；新Gateway Docker build exit0（12.91秒），原gate **231 tests：230 pass、0 fail、1既有skip**。tag `fg-main-acceptance-gateway:a441-20261117-budget`，image ID `sha256:a888be96fbd19a8993ac9faf5e42673674e8e1854fdadda93116405c2da680d9`；预算源码SHA256 `2b513b3aebb0c2bdff53f9c2de2ff05618e421c51137ee67ce933d1ad92e1696`，同时包含前轮财务修复。
- 新预算镜像归档→OCI/全部blob SHA校验→load **39/39**；归档 `candidate-budget-gateway-a441-20261117.tar`（51,029,504 bytes；SHA256 `8b8965883d06cd21d0f20d2990a2e6a2a6fd44b026bbe9cf1e56dcaa3be23f4c`）。前轮finance和更早九镜像归档保留，没有覆盖或删除。这里只证明本任务候选留存，不是生产旧版本/密码回退。
- 当前已实际更新本任务Gateway为上述budget镜像，**25/25**：精确源码/hash、任务挂载/网络、实际运行image、另外八容器身份/启动/重启次数不变；CA-verified HTTPS原session、素材完整document及原canvas完整document摘要一致，finance200。只替换本任务Gateway一次，没有数据库恢复/清理或生产操作。后续Compose up须显式选budget tag并保留 `compose/finance-gateway-pin.yml`（两个IP及可信来源不变），不要使用env中旧tag。完整命令/证据在 `compose/evidence/budget-gateway-update-results.json`。
- 更新后Chrome重新加载费用页，真实finance200/code0、原失败alert消失、console warn/error0；先把当前文档资源缓冲设为5000再导航，451条已观测资源无HTTP失败，不延伸到未观测范围。证据 `compose/evidence/budget-browser-finance-results.json`。`git diff --check`通过；所有exec任务已结束，无后台验收任务。
- 可复现命令：`node --test production-lab/meilin/gateway/fg-budgets.test.mjs production-lab/meilin/gateway/fg-finance*.test.mjs production-lab/meilin/gateway/fg-personal-finance.test.mjs production-lab/meilin/gateway/fg-retired-modules.test.mjs`；runtime `python3 compose/budget-native-schema-run.py` 每次新建隔离恢复库，完整Docker build/真实库命令及证据在 `compose/evidence/budget-{native-schema-run,native-schema-results,gateway-build-results}.json`，归档记录在 `candidate-budget-gateway-retention-results.json`，不纳入Git。
- 同步纠正PLAN中P1实际检查项：当前仅NAS/隧道；退役报表和历史worker不再列作必迁条件。仍未获生产访问/切流授权，真实NAS、隧道、历史数据及完整回滚门槛未关闭；候选dirty，不commit/push。

## 持续验收：真实财务故障修复、素材生命周期与本地切换（2026-11-17）

- Chrome 实际从个人素材、公司素材、故事与项目进入制作费用，发现 HTTPS finance 400；PostgreSQL 明确报 `42P01 fg_adcraft_workspaces does not exist`。修复 `gateway/fg-integration.mjs` 对退役广告表的硬依赖：只读检查两表是否存在，缺失时不 JOIN，存在时保留原历史费用归属、成员权限、预算和小组投影。不补建退役表，不清数据，不改接口 shape，不吞必需 schema 错误。
- 原有 finance/personal-finance/retired-modules 定向测试 **15/15**；新 Gateway Docker build exit 0，原 gate **231 tests：230 pass、0 fail、1 既有 skip**（standalone Gemini protocol fixture），没有新增 skip。新 tag `fg-main-acceptance-gateway:a441-20261117-finance`，image ID `sha256:1c409c8f454d4459e9ce0f4da28dc38aaa10b85e5a8d30d3a4010035166c12af`，源码 SHA256 `d92306f423b0a08e1a89b6f202c1b935804f95b66a77bf70ce179e7919fb8025`。
- 真 PostgreSQL 恢复到独立 local fixture 库后旧/新 HTTP handler 对照 **18/18**：缺表旧版400/新版200；native32 owner、无关成员、reviewer及伪权限参数正确；synthetic receipt USD0.12×7=CNY0.84，敏感 body 不泄漏。在此独立恢复库加载源码原有两张广告表后，历史成员权限/budget/group及归档权限与旧 handler 逐字 JSON 一致；没有向原主 fixture 补建退役表，没有调用模型。
- 真 CA HTTPS Gateway 新版→旧镜像→新版切换 **40/40**：旧镜像可真实复现400，最终新版200；原 session、素材完整 document、画布 revision/内容不变。只替换本任务 Gateway 三次，另外八容器 ID/image/StartedAt/RestartCount/Running 不变；没有恢复/清空数据库或操作生产。保留两个任务网络地址 `172.25.0.7`/`172.26.0.2`，未放宽信任。后续 Compose up 必须显式选新 Gateway image 并叠加 `compose/finance-gateway-pin.yml`，原 acceptance.env 默认仍是旧 tag，不能误回退。
- Chrome 完成纯文本素材创建→reload持久化→回收站→恢复；独立真实 HTTPS 隔离与 NAS regular-file guard **26/26**：跨账号/匿名/伪ID/不可信 Origin 拒绝符合合同，guard期间资产读写503但认证/外观继续，解除后完整 document 不变、拒绝写未生效。创建前存在性 GET404 是既有同步合同，不是资产丢失。公司素材空态、故事列表正常，但 synthetic 未分组账号不能证明真实历史团队已迁入。
- 本地九镜像 Docker save→OCI index/平台/config/layers/blob SHA校验→load **229/229**，归档 `candidate-retention-a441-20261117.tar`（936,721,920 bytes；SHA256 `2b7b1ff3882b4c7d87de5ccc322b5d612956aec3de190c859867c02853f6c522`）；这是修复前组合，保留旧 Gateway。新版单独归档重载 **39/39**，`candidate-finance-gateway-a441-20261117.tar`（51,028,992 bytes；SHA256 `97b39c60bc81bf01d15d4ad53b8712aad090695003527adab3009cd76c46972f`）。未删除镜像、不覆盖已有归档、不 commit 容器；OCI index与config digest不可混用，首次 harness 失败和纠正保留。不是生产旧版归档或异机恢复验收。
- Chrome 财务 full reload 后正常显示 CSV导入/未配置对账账号，无原失败 alert；2026-11-17 追加检查当前页 console warn/error 0。JSON 证据位于既有 runtime `compose/evidence/{asset-native-lifecycle,candidate-image-retention,candidate-finance-gateway-retention,finance-native-schema,finance-gateway-cutover,finance-gateway-build}-results.json`，构建及切换命令/日志亦保留；本节不声称付费模型、真实 SMB/隧道或生产切流通过。
- 尚未放行：真实 NAS/隧道配置与 stale-bind/在途恢复、真实历史用户/团队/媒体及旧URL、启用渠道的实际配置、生产发布身份/切流/回滚与密码分叉；Support 若启用还需真实完整处理链路。候选仍 dirty，未 commit/push、未访问生产。
- 追加浏览器只读巡检：音频设置、技能库101项、插件中心121项、短剧制作、旧版短剧、我的费用、个人信息均实际渲染；音频记录/profile请求200，邮件未启用有明确提示，未发起模型任务或更改插件。最终console warn/error 0，既有15项定向测试再次通过，文档diff检查通过。证据 `compose/evidence/finance-browser-followup-20261117.json`；Performance资源缓冲已达250，不能由其空失败列表推出整个巡检所有请求均无失败。进一步核验当前生产NAS/隧道、版本身份须用户另行明确只读访问授权，不能用仓内旧cloudflared/app配置替代现状。

## 持续验收：最终候选源码与实际运行产物复核（2026-11-17，财务修复前）

- 上一目标轮为实质进展（观测链路和独立库备份恢复已实现并验证），不是原地重述。本轮继续核对跨轮组合后的候选是否真正运行了当前源码，而非仅引用各模块较早的测试。使用本任务完整 base/standalone/isolation/TLS/Support/观测配置，一次 `docker compose … build backend web gateway yingce-agent support-web observability`，exit 0，34.81 秒；所有 tag 显式限定 `fg-main-acceptance-*`。原 Dockerfile gates 未修改或跳过，本轮复用命中的既有成功构建层，不冒称全部 tests 重新执行。构建前后 8,081 个关键源码/配置的 SHA manifest 不变，仍 dirty=true，不签认为 clean release。
- 仅 build，未 up/recreate。新 image 引用与运行容器所记 digest 不同，且 Docker 对原 Backend Image digest 的 `image inspect` 返回 No such image；保留该失败，不根据 tag/ID 猜测等价、不 commit 运行容器复制含凭据配置、不重启实例。改用实际内容验证：六个运行容器的应用目录、Go binaries、插件/Agent/Node 运行产物，与最终新镜像中的对应文件逐项 SHA 比较，六份 manifest 共 53,584 行完全一致。此证据只证明对应产物，不证明旧 image 引用可作为回滚 tag 使用；生产回滚镜像仍须实际核对保留。
- 最终 **37/37**：上述六组件产物、Web 当前 release 2,494 个文件在实际服务 bind 中逐字节一致、当前 asset inventory 精确匹配、上一版 inventory 均仍存在、额外文件仅为受保留策略约束的旧 hash chunks/发布 metadata/原版 Nginx 50x；经本任务 CA 校验的公开登录 HTML 和入口 assets 均与当前 image 字节一致，旧主站登录视频 Range 206 的 65,536 bytes 与源文件一致。九个既有容器的 ID/image/StartedAt/RestartCount/Running 均保持原值。
- 初次把整个 served bind 当作全新 image 比较会错误拒绝有意保留的旧 chunks 与 `.canvas-assets-{current,previous}`；真实 diff 与失败原因保留，按既有 `canvas-web-entrypoint.sh` 的当前/上一版及 7 天保留合同修正验收，未删旧资源、未忽略任何当前 release 文件差异。证据 `compose/evidence/candidate-final-{build-results,source-manifest,artifact-results}.json`、`candidate-final-old-image-inspect-failure.json`、`candidate-web-served-{difference.txt,contract-first-failure.json}`；构建命令及完整日志在对应 build results / `logs/candidate-final-build.log`。`compose` 为下文定义的同一 ignored runtime 路径。
- 另以空隔离 HOME、`FG_RUNTIME_TARGET=native` 实际执行 `scripts/auto-deploy.sh`，仍 **exit 78**，且 HOME 未创建文件；在锁/Git/Docker/旧站恢复逻辑前拒绝，没有执行部署。全仓 checked-out 源码仅见 `generateDueReports` 导出，没有实际 report-scheduler 调用入口。证据 `compose/evidence/release-unresolved-gates.json`；不把 fail-closed 正确当作发布/报表能力已经实现。
- **当前剩余验收范围（用户纠正后）**：NAS/隧道的实际入口与配置；运行 Compose 的 overlay/sourcebuild 与每组件实际版本；真实用户/团队/媒体引用、SMB 和已启用外部渠道；批准的发布版本、入口切换与可用回滚产物。报表调度/报表业务聚合已移出必需项；上述 auto-deploy exit 78 和仓内缺调度入口仅保留为历史测试事实，不再据此阻塞上线。生产 SSH 只读核验未获授权，未连接 `server` 或读取/修改生产；不得凭记忆另造 updater/scheduler，也不自动 commit/push。`gaps_found` 保持，未签字上线。

## 持续验收：Support/观测独立库备份与真实恢复（2026-11-17）

- 继续关闭本地缺口：原 native 维护只备份 Go 主库，不能泛化到独立 Support/观测库。扩展既有 `maintain-host.py` 与 `maintenance-storage.mjs`，不另建备份系统；仅显式 `FG_NATIVE_AUX_BACKUP_SERVICES=support-web,observability` 选择后启用，未设时仍保留原行为。先核验 running sidecar 的精确项目/服务 labels、DATABASE_URL、与所选 PostgreSQL 的网络或共享 namespace，要求独立且不重复的库名、同数据库用户。拒绝远程、非 PostgreSQL、主库别名、连接参数改目标及目录穿越；不猜连接、不改服务 env。远程历史库仍需单独备份方案。
- 独立库以 service/database 分目录保存在原 guarded NAS 备份树，原主库路径不变；严格作用域、链接拒绝、0600、guard 写入栅栏、原字节 SHA 读回、`pg_restore --list` 加完整数据流解码及已有备份不覆盖均保留。无新增调度器或生产维护任务变更；三个库分别快照，不冒充跨库原子恢复点，也不做 drop/clean/覆盖恢复。
- 最终 **77/77**：配置/实例/网络/目录隔离、原模块 networkless Docker 测试、真实三库备份与第二轮不覆盖、Support 4 表/26 行/1 序列及观测 6 表/29 行/2 序列的实际新库恢复；所有表的全行 digest/行数、全部 public 列/默认值/约束/索引及序列 last_value/is_called 一致。新恢复库为 `fg_aux_restore_a441_support_58dc63f2` 和 `fg_aux_restore_a441_obs_75c16ed5`，均显式 local，不删除旧 fixture。七个业务/sidecar 容器的 ID/image/StartedAt/RestartCount 不变。
- 原 native 维护验收 **70/70** 对最终源码重跑通过，主库新恢复 `fg_maintenance_restore_a441_3c9cd0fa` 共 177 表；恢复完整性专项 **10/10**。实际命令：`python3 <compose>/maintenance-auxiliary-acceptance.py`、`python3 <compose>/maintenance-native-acceptance.py`、`python3 <compose>/maintenance-restore-integrity.py`；`<compose>` 为下节已定义的本任务 ignored compose 路径。Python AST parse、`node --check production-lab/meilin/maintenance-storage.mjs`、`git diff --check` 通过。结果 `evidence/maintenance-{auxiliary,native}-results.json`、`maintenance-restore-integrity.json`，两脚本 SHA 与最终源码一致。
- 保留 harness 初次失败：AST 隔离抽取未带 DOCKER 常量、早期 Support fixture 未设后来的 database GUC；两者均在真实备份前失败。补齐隔离命名空间及核对原 support-local-schema 的 local fixture 来源，不改生产代码吞错、不修改源库 GUC 迎合测试。原失败证据在 `maintenance-auxiliary-{harness,support-guc}-first-failure.json`。
- 仅本任务 synthetic 数据及本地 NAS fixture，不是生产历史队列/观测库、远程备份、SMB 素材灾难恢复或生产调度器运行证据。下方较早章节“独立库备份恢复未验”仅保留历史语境；本地范围以本节为准。其余上线门槛仍未关闭，未 SSH/访问生产、停守护任务、调用模型或 commit/push。

## 持续验收：native 观测独立接收与 durable outbox（2026-11-17）

- 提取原 Next monitor/error route 的标准 Request/Response core，原 PostgreSQL 事务、幂等、脱敏、heartbeat 与迟到事件使报表失效的语义不变；旧 route 包装继续保留。新增独立 Node intake 与可选 Compose `observability` profile，默认不启用、不依赖 Next。启动必须显式 native target、数据库和至少 32 字符的专用密钥；只读检查既有 schema，不建表、不迁移、不借用 SESSION secret。能力/ready/写入全部认证，不新增公开 Gateway 放行路径。
- native monitor/outbox 配置显式 loopback origin 和专用密钥后实际投递，不再一律返回 75；未配置或对方没有 native durable-ack 能力仍返回 75 并原队列留存。原事件字节与 eventKey/时间不改写；仅 PostgreSQL commit 后匹配 native/ok/key/protocol 的 ack 才清队。原字节隔离永久错误、重试临时失败与错 ack、in-flight 换文件不误删；curl 禁用 curlrc/代理，platform 原协议行为保留。
- 真实 host 日志 producer 暴露初版 256 KiB envelope 上限不足：合法 261,883-byte 日志封装后 263,123 bytes。保留 `observability-max-log-first-failure.json`，最终改为 512 KiB 并实测原 producer 大日志完整入库；Content-Length/chunked 超限均实际返回 413，不 reset。32hex 身份原值只存 metadata.nativeUserId，不转 UUID，也不冒充旧报表已支持 native 业务聚合。
- 最终源码镜像与真实任务 PostgreSQL/outbox 验收 **72/72**；同一 image 启动缺配置/错误 target/空 schema 拒绝及不建表 **6/6**；原 monitor → 原子 outbox → 独立 intake → PostgreSQL 四服务事件 **4/4**。真实 report_runs 锁导致原事务回滚且留队，释放锁后同事件恰好一次提交。修正过的锁注入时序与重复 fixture unique 冲突均保留初次失败，不清表掩盖。native monitor 既有 **125/125** 对当前 source SHA 仍有效。
- `tsx --test tests/observability/server-log.test.ts` **2/2**、定向 `tsc -p compose/observability-tsconfig.json --pretty false`、`bash -n scripts/observability-outbox.sh scripts/service-monitor.sh`、`git diff --check` 均 exit 0。`compose` 指本任务 Git ignored 的 `production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/compose/`；主要证据 `evidence/observability-native-{results,startup,build,monitor-pipeline}.json`，最终 source SHA/build/running image 已一致核验。
- 本任务新 sidecar 的 loopback 测试口为 45213，仍非公开主站入口；唯一工作台入口仍为 CA-verified `https://127.0.0.1:45244/fg-six/`。初次发布端口失败实因为 task default 网络 internal=true，只为新 sidecar 接入已有 acceptance-ingress；保留两次失败，不改变六个既有业务容器的 ID/image/StartedAt/RestartCount 或网络。独立 fixture 库 `fg_observability_acceptance_a441` 不是历史生产库；空 schema 拒启库仍 0 表。
- 仅完成接收/持久投递，不代表 native 自动部署（仍 exit 78）、报表调度/业务聚合、外部告警、独立库备份恢复、真实 SMB/历史数据或生产切流回滚通过。未 SSH、未访问生产、未运行完整守护脚本、未停止守护任务、未调用模型、未 commit/push；`gaps_found` 保持。

## 持续验收：native 监测不能把存活当发布完成（2026-11-17）

- 原始函数在本任务真实 CA-verified HTTPS 上复现实质缺口：只检查 Gateway live/version 与 Web manifest，二者 dirty=true 仍报 healthy；未读取 Backend/database/schema/NAS ready，也没有与批准目标核对版本。原证据保留为 `compose/evidence/native-monitor-first-probe.json`。同时确认公开 `/api/health/ready` 与 `/fg-six/api/health/ready` 均返回 401；没有为监测放宽公开鉴权。
- 修改既有 `scripts/service-monitor.sh`：native 模式按显式 `FG_MONITOR_NATIVE_COMPOSE_PROJECT`（默认 fg-six-yingce）选择唯一 Backend，核验容器 ID、Compose project/service labels、Running、PostgreSQL/native guard 环境与只读 guard bind，再经该容器 loopback 读取 ready。严格检查 code/ready/started/draining、database/runtime/schema/NAS、schema current=expected 及整数类型；Gateway live 必须实际返回 `ok`，HTML 200 不算健康。不使用旧站 Compose helper，不启动/停止/重建任何服务。
- 分开报告 yingce-gateway/web/backend 与 yingce-release。release 必须核对三者版本与 commit 一致，并匹配进程环境中显式批准的 `FG_MONITOR_NATIVE_EXPECTED_VERSION`、完整 40 位 `FG_MONITOR_NATIVE_EXPECTED_COMMIT`，同时为 production、dirty=false 且 ready。缺期望身份或仍是 dirty/development 候选时为 unknown；混合版本、目标不符、探针失败或无效配置为 unhealthy。禁止从 running 身份自动反填 expected。此状态只检查版本/就绪，不代替历史数据、外部能力、部署和回滚验收。
- Git ignored harness 运行原始函数，**125/125** 通过：包含 metadata/严格类型、Backend 四类 checks/schema/draining、release 配置及混版、错误 labels/只读 bind/多容器拒绝执行、真实 loopback HTTP 编排与 CA-verified TLS/真实 Backend 探针。干净匹配 release 成功用例明确为 synthetic，不把 actual dirty 镜像伪装为 clean。真实任务栈三个服务均健康但 release 正确保持 unknown；两种 expected 配置下结果均留日志。五个任务业务容器的 ID/image/启动时间/restart/health 未变；未运行完整 monitor/生产锁/LaunchAgent，未调用模型。
- 命令：`python3 production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/compose/native-monitor-acceptance.py`；`bash -n scripts/service-monitor.sh`、`git diff --check` 通过。证据 `compose/evidence/native-monitor-results.json` 含最终脚本 SHA256 与 125 项详情，日志 `compose/logs/native-monitor-{unconfigured,explicit-dirty-candidate}.log`。platform 从 check_app 起的监测/恢复尾部与 HEAD 逐字一致；此前 native 降低重复告警的 dirty 修改保留，没有重复构建未变镜像。
- 仍为 gaps_found：native auto-deploy 仍显式拒绝未实现部署；上游 Linux Host Updater 针对另一套官方 Compose/镜像，且其 rollback 会 dropdb/restore，不能直接套用本项目完整 Compose 或当作无数据丢失回退。未执行该工具。native outbox/报表、异常 bind/真实 SMB/在途恢复、Support 真 worker/模型/独立库恢复、历史数据和生产入口/切流回滚仍未关闭；没有 commit/push/部署或生产探测。

## 持续验收：native 维护入口与数据库备份恢复（2026-11-17）

- 发现另一条旧目标旁路：`production-lab/meilin/maintain-host.py` 原先不区分 runtime target，NAS 失败会停止 Backend/个人运行环境，恢复则只用基础 Compose 重建，可能覆盖 standalone 的 native/guard 配置。新增显式 native 分支，在旧 stop/start/rebind/provision 路径前退出；未显式选择 native 却发现现有 Gateway 为 native 时也拒绝旧维护路径，不靠停止 LaunchAgent 或修改生产来验证。
- native 维护保留现有 PostgreSQL 日备份能力，而非把全部维护静默跳过：核验 Backend/Gateway/Postgres 的 Compose labels、运行状态、native 模式、guard/media/root bind；核对 Backend DATABASE_URL 的 host/port/user/database 与所选 PostgreSQL 一致，拒绝备份错误的实例或库。随后要求 ready/NAS 保护状态通过，复用既有 storage helper 做 probe/备份/读回。临时 storage worker 使用运行 Gateway 的精确 image ID、无网络、只读根文件系统、cap-drop/no-new-privileges 和只读 guard bind，不注入数据库或模型凭据；只清理本次随机命名的临时容器，不重建或启动业务服务。
- 追加故障验收实证：任务备份的内存副本截去末尾 256 bytes，`pg_restore --list` 仍 exit 0，完整数据解码则 exit 1。已将 native 备份门槛补为 TOC + `pg_restore --file=/dev/null`，完整读取数据流但不连接数据库；同一损坏输入在原生维护中被拒绝，既有正常归档不被覆盖。未截断磁盘原件，第一次仅 TOC 过关的证据保留在 `maintenance-corrupt-archive-first-probe.json`。
- storage helper 在 native 下验证标记、guard、目录和文件类型，拒绝目录/链接/FIFO guard 与备份路径链接；标准输入读取阻塞期间如果 guard 激活，后续写入被拒绝。发布前再检查，guard 激活时不清理 NAS 暂存文件；不声称跨宿主原子中断在途 I/O。native probe 复用稳定文件，不制造每轮随机删除。已有日备份必须实际读取并通过 `pg_restore --list`，不是仅凭 exists 签为成功；串行维护不覆盖已有备份。
- Git ignored harness 只加载原始函数和隔离入口分支，最终 **70/70** 通过；包含无网络容器运行原始 MJS、guard 异常/标准输入边界、native/legacy 入口、身份/挂载/数据库选择及真实任务栈备份。真实本地 custom archive 10,718,667 bytes，读取后摘要一致，再次维护未覆盖；完整恢复至新建任务库 `fg_maintenance_restore_a441_c692d3ff`，177 张 public 表及 users/projects/tasks/resources 数量一致。Backend/Gateway/Postgres 的容器 ID/image/启动时间/重启次数不变，生成 active=0；没有执行完整生产维护脚本或生产锁/LaunchAgent，没有调用模型。
- 命令：`python3 production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/compose/maintenance-native-acceptance.py`；`node --check production-lab/meilin/maintenance-storage.mjs`、Python AST parse 与 `git diff --check` 通过。证据为同目录 `evidence/maintenance-native-*.json` 和 `logs/maintenance-native-*.log`，含最终源码摘要；原 platform 维护主体从 running 检查起逐字不变，仅增加 native 保护入口。脚本从候选源码读取，不重复构建未变的应用镜像。
- 更深的恢复比对由 `python3 production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/compose/maintenance-restore-integrity.py` 完成：7 张关键表（users/projects/tasks/resources/fg_accounts/fg_groups/fg_memberships）的全行摘要、所有 public 列的类型/默认值/可空性/排序规则一致；238 个约束与 816 个索引的成员、状态和语义也核验。最初逐字比较在 3 个 CHECK、2 个部分索引上失败，原始差异和失败记录保留：PostgreSQL 把 varchar 数组整体 cast 改写为逐元素 cast。没有修改业务约束或忽略这些对象；在恢复库中用相同类型的临时表重新解析两种原始表达式，回滚事务，逐一证明 canonical 定义一致，再核对约束 flags 与索引 key/validity 等元数据。10/10 项完整比对通过，证据 `maintenance-restore-integrity.json` 及 constraint/index-roundtrip/diff JSON；不报告全部 SQL 原文逐字一致。
- 范围仍是本任务原生业务数据库与本地目录 bind，不是生产历史库、Support 独立数据库/NAS 素材全量备份、真实 SMB 故障恢复或切流演练。native 自动部署、报表/outbox、目标生产入口及真实业务门槛仍未关闭；未 commit/push、未访问生产、未停止任何守护任务。

## 持续验收：native NAS 健康巡检与恢复边界（2026-11-17）

- 复现并修正 native supervisor 候选的两个本地缺口：旧分支即使宿主完全健康也每轮写 disabled/recovery-pending，且固定宿主守卫目录可能与 standalone 实际挂载的 `FG_NAS_STATE_DIR` 不同。现在读取与 Compose 一致的显式目录，要求已存在、可访问的真实绝对目录；只在无 guard/无待恢复标记、宿主挂载与标记通过、且精确的 backend/gateway labels/环境/bind/媒体身份/写读/ready 均通过时保持健康。容器向既有稳定探针写入随机 nonce，宿主须读回同一值，防止旧 bind 上的固定标记假健康；不删除稳定探针制造 SMB 延迟删除文件。不重建任何容器，不触发旧 Next；宿主媒体身份及回执检查也受超时限制。
- 保持恢复 fail closed：已有 guard 或 recovery-pending 时仍不自动解除；任一探测失败即保护并持久记录待恢复。共享守卫写入改为 `O_NOFOLLOW` + `O_NONBLOCK`，不跟随链接、不截断原内容，目录/FIFO/悬空链接安全失败；即使守卫写失败也尽力保留恢复标记。不把本改动描述为 native 自动恢复完成，也不在生产启用脚本验证。
- 验证只提取候选的原始函数到 Git ignored harness，未 source/执行完整生产脚本，未注册真实守护锁/投递 outbox/请求 SMB 挂载。最终 55/55 项通过，覆盖旧行为复现、目录选择/校验、异常守卫不破坏目标、健康轮次不误封、恢复标记不清除、Docker 身份/挂载歧义、宿主探针超时/旧回执与失败保护；另用本任务真实 Docker 验证 backend/gateway 探针及连续两次完整健康轮次，SMB mount inventory 明确为 synthetic，容器 ID/image/启动时间/重启次数不变。最终计数及源码摘要以 `compose/evidence/nas-supervisor-results.json` 为准；命令 `python3 production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/compose/nas-supervisor-acceptance.py`。
- 首次真实探针拒绝了任务原有占位 NAS marker（`isolated a441 compose acceptance only`），保留失败日志/断言，只把任务自身 marker 修为既有 `fg-studio-media:v1` 协议，不放宽生产检查、不重启服务。`bash -n scripts/nas-supervisor.sh scripts/auto-deploy.sh scripts/service-monitor.sh scripts/observability-outbox.sh` 与 `git diff --check` 通过；本轮只改 Shell 与文档，不重复构建未变化的 Backend/Gateway。
- 仍为 `gaps_found`：异常 guard 的 bind 视图恢复、真实 SMB/在途恢复、native 自动部署、outbox/报表以及真实历史业务/模型与目标生产切流门槛没有被这些检查替代。未 commit/push、未访问或修改生产、未停止守护任务、未调用模型；原先失败证据全部保留。

## 持续验收：独立 Support 接入（2026-11-17）

- 从原 Next route 提取 `lib/support-bot/web-api.ts`，保持 PostgreSQL queue、owner 隔离、截图、限流、取消、反馈与 SSE；原 route 继续用原 Next 身份，不替换旧 worker。新增非 Next HTTP server、独立 `support-web` Docker profile 和 Gateway native relay，网页身份只能来自已核验的 Go session。独立 `SUPPORT_BOT_WEB_RELAY_TOKEN` 不复用原生只读取证 token；缺少配置、错误 URL、服务不健康或 disabled 时 status 不解锁 UI，不回退旧主站。配置与回退边界见 `production-lab/meilin/README.md`。
- 原样支持 native 32hex 与旧 UUID owner，保留 job/openId 身份不一致硬拒绝；Canvas/产品只读取证仍要求 active 精确映射。旧 FG creator / Production Lab UUID 数据源先拒绝 native32，防止 PostgreSQL 隐式 cast 访问另一命名空间。补查修复产品 operations 分支遗漏的 UUID-only owner guard；20 项 identity 与 26 项产品 owner 边界断言均在无网络容器中通过，不能据此称真实产品取证或 worker 已跑通。
- 只在本任务 PostgreSQL 新建 `fg_support_acceptance_a441`，设置数据库级 local 标记并运行既有 006、016–021 schema。标准 HTTP core + 真实隔离库 22/22；原先缺 observability 表的告警保留，补齐原迁移后重跑通过且 stream-close 日志实际落库。Support/Gateway/Web 原 Docker build gate exit 0（88.45 秒）；最终正文修复镜像另行重建通过。任务私有 overlay 让 Support 共享本地 PostgreSQL network namespace 以满足 localhost 环境限制，不是生产部署模板。
- 真实 CA 验证 HTTPS 29/29：native32/UUID 两账号、入队、截图、读取/取消/反馈隔离、伪造 owner、ExpectedUser、Origin、SSE 取消更新与退出后会话撤销断流。反馈验收使用明确标记的 synthetic completed fixture，绝非 worker 或模型产物。私网缺/错 token 和缺/非法 owner 均 401；14 项 HTTP readiness/config fail-closed 通过。
- 追加实测发现 chunked 正文超过 28 MiB 会 ECONNRESET（声明长度超限原本为 413）；HTTP 包装改为阻断取消向 socket 传播，未读完错误请求关闭连接。私网声明长度超限及 chunked 超限均返回 413，合法大小坏 JSON 返回 400；公开 TLS→Gateway→Support 的 chunked 超限也返回实际 413，服务仍 ready，随后正常退出。失败结果未删除，未放宽正文上限。
- Chrome page 39 保留原账号/缓存，原画布刷新仍“已同步”；打开新助手，提交标记为不调用模型的验收问题，pending 显示，刷新后恢复同一任务，终止后再次刷新仍 cancelled。SQL 核验 owner/openId 原样为32hex、同一 job、attempts=0、pending/processing=0；1 条 synthetic 反馈和 11 条 stream-close 日志已落库。页面无横向溢出/外部 origin，console error/warn=0。
- 验证命令：root `tsc --noEmit --incremental false --pretty false`、Web 两改动文件 ESLint + `tsc --noEmit --pretty false`、Gateway 原 `node --test .../*.test.mjs`（231/231）通过；未新增仓库测试文件、未升级依赖、未启动 worker、未调用模型。证据位于同一 ignored runtime 的 `compose/evidence/support-*.json` 和 `compose/logs/support-*.log`，包括 core、identity、产品 owner、HTTPS、chunked 修复前后、readiness、浏览器/SQL 与构建记录。
- 尚缺真实 worker runtime/源码归属与模型诊断、历史 queue/owner 数据保留演练及生产配置；旧生产 worker 未更新。独立 HTTP ready 只证明接入/数据库可用，不证明 worker 或模型可用，不能把 UI 入队成功或 synthetic 反馈当作助手端到端完成，更不能据此批准主站切流。
- 补充验证：原只读取证 relay 的19项替身断言验证 native32 原样转发、旧UUID canonical、active mapping 与独立 read token；完整 worker 模块在无网络容器加载成功（559个 bundle inputs，无 Next runtime），没有启动 worker/消费队列。提取后的 HTTP core 与原 route 在仅替换认证回调/标准 Response/导出名后逐字一致；既有 observability 测试2/2通过。均不能代替真实产品或模型验收。

## 持续验收：NAS runtime guard（2026-11-17）

- 修复前只读审计确认：旧 Next 的 `lib/local/storage.ts` 消费共享 disabled guard，native supervisor 候选也会写该文件，但 standalone Backend/Gateway 没有挂载 `/run/fg-nas`，Go 启动/health 仅检查 NAS ready marker。原审计证据 `compose/evidence/native-storage-guard-audit.json` 保留，不与下述实际运行结果混为一谈；始终未操作生产。
- 当前仍不能关闭完整 NAS/运维门槛：本轮补齐下述 Go/Gateway 代码和编排，但其它独立产品运行时的全部 NAS 消费者、真实 SMB/bind 恢复、在途任务和 native 自动部署仍待收敛；不是单纯等生产凭据。native 自动部署仍明确 exit 78，观测 outbox/报表与旧运行时关系也未全部关闭；Support 或本地 guard 通过都不替它们签字。
- 已增加独立 Go/Gateway guard 消费及 standalone 显式只读挂载：默认 platform 未设置变量不变，配置错误或 disabled 任意类型都关闭业务入口，新 WSS 与短代理也不能旁路。Go ready 纳入 NAS，保留 live/登录恢复/外观；本地资源读写删、回收归档、媒体暂存/兜底/播放、凭据创建及插件/技能/姿势落盘增加边界检查。生成/删除/补传队列领取前暂停，领取后未执行的暂停带 owner 栅栏退回本次 attempt；不擅自中断已提交的上游请求，不把检查与真实文件 I/O 视为跨宿主原子事务。
- 本地静态/既有验证：`go test ./internal/storage ./internal/repository ./internal/handler ./cmd/server ./internal/poselibrary -count=1` 通过（pose library 无既有测试），Gateway `node --test production-lab/meilin/gateway/*.test.mjs` 231/231；ignored runtime 的 Go inline 42 项、Node inline 25 项通过，覆盖缺省兼容、无效/缺失/不可访问目录、普通/目录/悬空 guard、HTTP/短代理、队列不领取/不消耗 attempt、owner 栅栏及恢复领取。第一次编译误将 error-only 函数返回二元值，已修正并保留失败证据。
- 最终 Backend/Gateway **原 Docker gate** 完整通过，未跳过测试，523.44 秒；仅更新本任务容器。真实 CA 验证 HTTPS/私网状态与 PostgreSQL worker 共 42 项通过：普通文件 guard 期间 ready=503、live/账号恢复/旧登录影片可用，业务读写/新任务拒绝；真实生成（synthetic local-render，无模型路径）/删除/补传队列跨完整轮询间隔仍 pending、attempts=0、无租约。清除正常文件 guard 后无需重启恢复，同一 PNG 字节一致；仅 synthetic 删除 outbox 恢复执行，按既有 NAS 回收策略保留 bin 副本和摘要，而不是直接 unlink。新 Canvas/Speech WSS 另 4 项真实 TLS 握手通过，guard=503、恢复后匿名=401/403，不提供 Cookie、不连接模型。
- 失败边界保留：harness 最初误用 `finished_at`（实际为 `completed_at`），只修正 ignored SQL；本地 NAS fixture 原将 media/studio 配为兄弟目录，删除 worker 安全拒绝，现改为 NAS-root/media 与 `/data` 同一宿主目录，未放宽 `SameFile`/路径检查。异常 guard 类型演练出现宿主已删除、容器枚举为空但 `lstat` 仍见旧符号链接，正常文件修复后也未恢复，业务持续 fail closed；仅隔离任务隔离旧测试目录并重新 bind 两个候选容器后恢复。**异常类型完整恢复仍是失败记录，不计入上述正常文件协议 42 项成功，更不作为真实 SMB 自动恢复通过。**
- 最后 Chrome page 39 保留原会话/缓存刷新，原画布 title/一个文本节点不变，远端 revision=6、UI 已同步，无横向溢出/外部 origin，刷新后 console error/warn=0。最终任务生成/补传 pending=0、synthetic 删除 outbox=0；代理实际地址仍匹配显式信任配置。证据 `compose/evidence/nas-*.json`、原始/修正 logs 和 ignored harness 全部保留；未新增仓库测试文件、未调用模型、未 commit/push 或访问生产。

## 持续验收：可信代理与来源限流（2026-11-17）

- 修复公开 TLS → Gateway → Web → Go 的来源信任合同：TLS 重置 XFF 并清除 X-Real-IP/Forwarded；Gateway 仅对显式受信 peer 接受单一合法来源 IP，缺省不信任；Go 在初始化数据库之前校验显式可信代理配置，只读取受信 XFF 链，拒绝 `/0` 和无效值。standalone 缺省为空时安全禁用信任，原 platform 未配置新变量时保持原行为。配置及回退边界见 `production-lab/meilin/README.md`，不能把本任务临时地址复制到生产。
- 验证：`node --test production-lab/meilin/gateway/*.test.mjs` 231/231；Node inline 24/24（IPv4/mapped IPv6/IPv6、无效配置、缺省不信、逗号链拒绝及敏感来源头清洗）；`GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./cmd/server ./internal/handler ./internal/auth` 三包通过。Backend/Gateway 原 Docker build 含原 gate 全部通过（546.70 秒），另以无网络临时容器验证 Go 对 bad/IPv4 `/0`/IPv6 `/0` 三类配置在数据库初始化前退出。
- 仅核实 labels 后更新本任务 Backend/Gateway/TLS，Backend/Gateway healthy；实际复核 TLS/Web/Gateway 地址与信任配置一致。初次 `compose up` 未重建挂载配置路径未变的 TLS，导致旧 Nginx 内存配置仍生效，伪造 XFF 检查失败；失败证据保留。随后仅强制重建本任务 TLS，再复核地址并重跑，没有改动生产或放宽检查。
- 实际两个专用来源容器经 CA 验证的 HTTPS 入口请求：来源 A 前 50 次错误凭证为 401，第 51 次为 429，随后四种 XFF/X-Real-IP/Forwarded 伪造均仍为 429；来源 B 即使伪造为 A，首次仍为 401。Go 数据库审计分别记录真实 A/B 来源 55/1 条，不是共享代理 IP。另从不受信 peer 直接请求 Gateway/Web/Backend，三条日志均保留真实连接来源，未采纳伪造 IP。
- 正常 HTTPS 登录、Secure/HttpOnly 会话、身份、受保护画布 ExpectedUser 200/403、旧影片 Range、退出及会话撤销等 9 项回归通过。初次 harness 错把公共 session probe 当受保护资源检查，已改用原画布 API 核验 ExpectedUser，未改产品行为。真实浏览器保留原会话与缓存刷新后，原文本仍在、状态“已同步”、无外部 origin/横向溢出，console error/warn 为 0。四个 native 运维脚本仅 `bash -n` 通过，没有执行脚本或操作生产服务。
- 新证据位于既有 Git ignored runtime 的 `compose/evidence/trusted-proxies-unit-results.json`、`trusted-proxies-rebuild.json`、`up-trusted-proxies.json`、`trusted-proxy-startup-rejection.json`、`https-source-ip-before-tls-reload.json`（失败历史）、`https-source-ip-results.json`、`direct-proxy-forgery-results.json`、`trusted-proxy-business-harness-correction.json`、`trusted-proxy-business-regression.json` 及 `compose/logs/`。本地通过不关闭生产入口/代理拓扑和真实提供方门槛，Support 接线仍未完成。

## 独立 worktree 验收（2026-11-16）

- 范围：`/Users/zhangyu/.codex/worktrees/a441/fgai-app`，分支 `codex/main-site-migration-acceptance`，基线 `778ac3ef23793566cd1d6dae62d820c1cb9cf1f1`。使用本任务隔离 PostgreSQL/Redis、Gateway/Nginx/Go；入口 `http://127.0.0.1:44116/fg-six/`。没有启动 Next，旧站 sentinel 请求日志为 0 bytes；没有访问生产或调用付费模型。
- UI：旧站 `fg-hero-4k.mp4` 与 poster 字节一致复制到 Canvas 静态资源；前后端默认值同步，base path 解析保留自定义媒体优先级。Gateway 只匿名放行两份指定媒体的 GET/HEAD，其他文件和写方法不放宽。实测 MIME、Range 206、3840×2160 自动播放正常。取消两栏/白色遮罩/页脚底板，采用全屏影片、左侧悬浮玻璃表单；表单保留全局明暗皮肤，未强制 dark provider。
- 浏览器：1550×900 与 1440×900 桌面、1024×768、390×844 mobile、900×600 短屏实测；无横向溢出，注册长表单可滚到底，影片固定不随内容滚动。深链 query/hash 在登录/注册/找回之间保留；键盘焦点可见。reduced-motion reload 不挂 video，封面正确，手动播放 readyState=4。注册/找回在未配短信邮件时明确禁用；未把此环境配置限制误判为迁移缺陷。最终视觉待用户确认。
- 动态业务：inline Node 使用真实 Gateway → Nginx → Go，16/16 检查通过：synthetic 用户 profile、快捷提示词 CRUD/用户隔离、创建画布并读取、另一普通用户读画布 404、公开分享/撤销、创作历史写入和读取。另 13 项通过：1px PNG 上传/读取/隔离、Canvas WebSocket welcome、改密/旧密码拒绝/旧会话失效、新密码登录、心跳撤销连接 `1008 session expired`、logout 及会话拒绝；synthetic 密码随后恢复。
- 团队目录：最初 HTTP 400 的原因是本地 Gateway 缺 `FG_TOPICS_FILE`（ENOENT）；补齐指向仓库现有 `lib/production-lab/topics.json` 的本地配置，只优雅重启本任务自己的 Gateway。重新验收 4/4：成员/管理员均 200，seeded group/membership 与画布 owner 快照不变、sentinel 无请求。保留初次失败证据，不视为产品修复或全部首次通过。
- Importer：专用 source/target 测试库与主验收库隔离。真实 `node production-lab/meilin/gateway/migrate-platform-accounts.mjs` 的 dry-run/apply、重复 apply、UUID/roles/disabled/bcrypt 保留、空密码补齐、各类冲突整批拒绝、事务中途回滚和同库 alias 拒绝，28/28 通过。原 240-byte UTF-8 fixture 仅验证 Node KDF；本轮另建专用 source/target，以真实 schema migrator、Gateway initializer、account importer 及 Go HTTP 登录补测 270-byte UTF-8 密码，9/9 通过，包含错误密码 401、disabled 403、原 UUID 与关联保留。未把两组不同 fixture 混称为同一次验证；不以 synthetic 数据证明生产迁移成功。
- 可重复检查：Gateway 目录 `node --test *.test.mjs` 231/231；Web 目录 `bun test test/auth-theme.test.ts test/appearance-bootstrap.test.ts test/site-appearance-and-skins.test.ts test/fg-entry-url.test.ts` 27/27；`./node_modules/.bin/eslint src/pages/auth/auth-scene.tsx src/stores/use-appearance-store.ts` 通过；根目录 `VITE_FG_AUTH_MODE=native FG_CANVAS_BASE_PATH=/fg-six/ bun run --cwd production-lab/meilin/canvas/web build`（含 TypeScript）通过，仍有大 chunk 提示。Go appearance 专项及 auth/handler/database/repository/cmd/server 五包既有测试通过。上述为 UI 阶段结果；后续已实际尝试隔离 Compose build/up，结果见本轮构建缺口。生产脚本仍只做 `bash -n`，未执行。
- 证据：Git ignored 的 `production-lab/meilin/canvas/.local/project-workbench-debug/acceptance-20261116/` 中 `login-immersive-final.png`、`runtime-business-results.json`、`runtime-session-media-results.json`、`runtime-team-results.json`、`importer-results.json`；运行凭据文件权限 0600，不写进文档/提交。

### 本轮发布阻塞修复与补验（2026-11-16）

- WS：将 realtime 的 path 解析置于异常保护内；in-process mock 的 parser 异常返回 400，且不调用认证；Canvas/Speech 两个 upgrade listener 的 reject 均检查 writableEnded，避免同一 socket 重复 end。没有向 live Gateway 发送异常 upgrade 或崩溃复现流量；本地正常 WebSocket welcome 已回归。
- 预期账号：`proxyHeaders()` 只为 `X-Canvas-Expected-User` 保留精确例外，其他内部身份、认证及转发伪造头仍被清理。真实 Gateway → Nginx → Go：同账号 200、不同账号 403、未带断言 200；未扩大身份凭证信任。
- Linux.do：login/reauth 发起时写入 600 秒、Path=/、HttpOnly、SameSite=Lax（HTTPS 下 Secure）的 browser-bound state cookie；callback 先恒定时间比较 cookie/state，再读取和消费一次性 state。Gateway 只在三个精确 callback 路径转发合法 state cookie，响应保留 state/session 双 Set-Cookie；保留原猫影片 allowlist。
- OAuth 跳转：`safeOAuthNext()` 保留原同站路径限制，使用 URL String 保留 fragment。正常 in-process login/reauth 14/14 流程通过（7 次 login + 7 次 reauth、28 次 mock 响应），覆盖 HTTPS/HTTP loopback、三类 callback、根路径/前缀、PKCE、query/编码 fragment、cookie 属性、state 消费及 reauth 原 session 保留。未运行真实 Linux.do 浏览器跨站授权。单 state cookie 存在并发限制：同浏览器后发起的 login/reauth 会覆盖此前 cookie，旧标签页 callback 可能被拒绝；14/14 未覆盖此场景，不冒充支持多标签并行授权。
- Monitor：manifest 身份断言改为当前 `meilin-web`，既有状态 key 保留。只提取 `native_runtime_summary()` 纯函数，以实际本地 manifest 验证新身份接受、旧身份拒绝，2/2；只做 `bash -n`，未执行监控脚本或操作生产任务。
- 本轮实际回归：Gateway 目录 `node --test *.test.mjs` 231/231；backend 目录 `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./internal/auth ./internal/handler ./cmd/server -count=1` 三包通过；四份改动 Gateway 文件 `node --check`、`bash -n scripts/service-monitor.sh`、`git diff --check` 通过。重新编译 Go binary，仅核实 cwd/命令后优雅重启本任务的 backend/Gateway；正常 WS、预期账号、匿名影片/封面及 Next sentinel 零请求共 7/7。防御性 in-process mock 4/4，包含两个 listener 共用 socket 仅结束一次；最终补丁后重跑 Gateway 231/231 与正常 live 链路 7/7。
- Synthetic Go 登录补验：新库以真正的 `migrate-schema up` 初始化，再复用 Gateway `initializeFG()`，不是手写版本标记。前置 fixture 曾因旧 reader 不存在、schema-only 副本无迁移历史、仅 Go schema 缺 `fg_accounts` 而失败；三次后停止原路径并核对 schema，调整为完整既有初始化链后通过。原 importer 28/28 证据和首次失败记录不改写；新补验 9/9、270-byte 密码登录证据单列。
- 证据新增于同一 Git ignored runtime：`gateway-regression.log`、`go-regression.log`、`security-inprocess-results.json`、`security-runtime-results.json`、`monitor-manifest-results.json`、`importer-go-runtime-results.json`、`oauth-inprocess-results.json`、`catalog-regression.log`、`catalog-protocol-regression.log`、`catalog-runtime-results.json`、`backend-gate-diagnosis.json`。OAuth 临时 overlay/Go 入口已清理，JSON 记录 fixture 和命令形状而非可直接重放的完整 harness；既有可重复 Go/Gateway 回归命令见前项。本地浏览器补验 1558×819，无横向溢出，猫影片 3840×2160、readyState=4、自动播放正常。

### 隔离 Compose 首轮构建（2026-11-16，失败历史保留；后续结果见下节）

- 使用原 `compose.yml` + 显式 `compose.standalone.yml` + Git ignored 的本任务 isolation overlay；project 为 `fg-main-acceptance-a441`，独立 image tag、internal network、volumes、127.0.0.1 端口及 synthetic NAS 目录。Compose JSON 121 项隔离校验通过；未接入生产 `fg-studio` 外部网络，未挂真实 NAS。测试用 marker 不代表 NAS/storage guard 已验收。
- 已启动本 project 的 PostgreSQL/Redis，均 healthy；Gateway/Agent 初次镜像构建成功。原 backend Dockerfile 的 `go test` gate 真实失败，基础镜像拉取成功，**不是 registry 鉴权或下载失败**。完整 native stack 未启动成功，不能把局部镜像/进程通过当作完整 Compose 验收。
- 首次 backend build 耗时 887.17 秒，发现 16 项顶层失败（含 3 个子 case 共 19 条不同 FAIL）：最小测试 fixture 缺 `system_settings` / `creation_conversation_resources`、模型目录错误传播、声明式文本 output ceiling、工具 golden、插件 Secret Key 合同、Claude stream 结束标记等。主机 `go test ./internal/app -run '^(TestUpdateSystemChannelEnabledOnlySkipsOutboundResolution|TestAdminCatalogKeepsHealthyModelsWhenOneRevisionIsInvalid|TestProjectCoverAppearsInResourceReferences|TestChannelModelContractRequiresSecretKeyFromDeclaredAuth|TestStreamingClaudeParserKeepsSignedThinkingBlocks|TestCloudAgentSupportedToolNamesGolden)$' -count=1` 同样复现六项，不把它误归因为仅 Linux/镜像环境问题。
- 构建期间确认并修复两个独立问题：Web Dockerfile 漏 COPY 前端引用的 `appearance_theme_packs.json` / `platform_knowledge.json`；仅补两条 COPY，原 TS2307/连带 TS7006 消失，原隔离配置缓存重建 Web exit 0（30.94 秒），未改 TS、依赖或断言。另修 `AdminLogicalModels` 的单个坏 revision 导致整个模型目录失败：保留不可用条目及 ConfigurationError，不遮蔽正常模型；既有 `TestAdminCatalogKeepsHealthyModelsWhenOneRevisionIsInvalid` 和 LogicalModel 专项通过。最终本地 backend 已重编译/更新，管理员正常目录及账号一致性 smoke 4/4；坏 revision 隔离由 Go 既有测试覆盖，不冒称 live fixture。
- Secret Key 保存校验是真实缺口而非过时断言：渠道模型保存此前只硬编码 JiMeng，未按 Tencent/AWS 插件的 `auth.secretField` 拒绝缺少第二把密钥的配置。现复用既有 `protocolAuthUsesSecretKey()`，保留 registry 未命中/禁用/不可用、capability 匹配及双密钥非空边界，无新 fallback。在 backend 目录执行 `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test ./internal/app -run '^(TestChannelModelContractRequiresSecretKeyFromDeclaredAuth|TestBuiltinJiMengVideoContractRequiresSecretKey|TestChannelFromRequestStoresConnectionWithoutDefaultProtocol|TestAdminCatalogKeepsHealthyModelsWhenOneRevisionIsInvalid|TestLogicalModel.*|TestAdminLogicalModel.*)$' -count=1` 通过（`catalog-protocol-regression.log`）；只读复核确认无新增明显安全/接口问题，完整 backend gate 仍未通过，不把此专项通过当全栈成功。
- 最终 Web/Gateway/Agent 三镜像构建成功；Gateway 在最后 WS writableEnded 补丁后重建，内置测试 230 passed / 1 skipped / 0 failed（主机全量 231/231），未用旧镜像冒充最终源码。Backend 未再完整重建，仍保留首次失败事实；不能将目录专项修复等同于剩余 gate 全部通过。配置与镜像 dirty=true，未冒充 clean release。
- 进一步区分测试合同：最小 schema fixture 必须补 `system_settings` / `creation_conversation_resources`，不在生产代码中吞缺表错误；Claude signed-thinking fixture 缺终止事件，不能放松 parser 的未完整响应拒绝逻辑；supported tool names 为当前 40 项、golden 39 项（新增已完整接线的 workspace_overview），另有 agent_profile_read 顺序变化，需核对合同后更新现有 fixture/golden，不自动重录掩盖差异。本轮未修改测试源码或 golden。
- 声明式文本上限失败进一步核实为旧 fixture 以裸 context 调用当前需要 protocol registry 的入口；生产 provider 已注入 registry，不能据此认定真实 provider 上限回归，也不能擅自增加生产 fallback 仅让旧测试通过。64000 预算测试在 `system_settings` 缺表处停止，后续 provider 断言未执行。两项已有专项重跑 exit 1，未修改测试源码。
- 没有通过修改/删除 Dockerfile gate、忽略失败、自动刷新 golden 或让生产代码容忍缺 schema 来放行。构建配置/命令/完整日志位于同一 runtime 的 `compose/evidence/commands.txt`、`compose/evidence/build-results.json`、`compose/evidence/final-build-results.json` 与 `compose/logs/`；private env/config 权限 0600。

### 授权修正 fixture 后的构建与整栈验收（2026-11-16）

- 用户确认继续后，只修正现有测试：渠道 helper 补 `SystemSetting`；资源引用 helper 补 `CreationConversationResource` / `AgentProfile` / `ApiCallLog`；声明式输出 fixture 显式注入官方 registry；Claude signed-thinking fixture 补合法 block stop/message delta/message stop。原 16384/64000 上限、签名和安全断言保留，未加生产 fallback 或吞缺表错误。
- 仅更新 `supported_names.json`：新增已完整接线的 `workspace_overview`，保留实际注册顺序（`agent_profile_read` 在 Memory/MCP 前）。核对提交 `a9075b71` / `0cc760de`、schema/policy/binding，未使用全量 `UPDATE_GOLDEN`。13 项 fixture 专项通过（2.877 秒），golden 专项通过（1.428 秒）。
- 使用同一 project/env/isolation overlay 执行 `docker compose … build backend`，exit 0，310.32 秒。原 Dockerfile 的 app/handler/protocol/repository/canvas/prompts/platform 全包 gate 与全部后续专项、server/migrate 编译均通过；没有修改或跳过 gate。四类业务镜像均已实际成功构建，仍为 dirty=true。
- `docker compose … up -d --no-build --pull never --wait … postgres redis migrate yingce-agent backend web gateway tls` 成功，migrate exit 0，其余服务运行。首次全 internal 网络没有发布宿主端口，保留失败；仅 TLS 增加本 project 专用 ingress bridge 后，loopback HTTPS 可访问，DB/Redis/Backend/Gateway/Agent 仍仅连接 internal 网络，没有连接生产或旧主站网络。原 `tls.conf` 字节不变，使用本任务 localhost 证书，不安装系统信任、不冒充生产 TLS。真实 NAS 未挂载，marker 仍是 synthetic fixture。
- 数据只来自本任务三个 synthetic UUID actor，加一个独立 32hex native fixture；直接 seed 到空的隔离库，原库只读，不把此步骤当 importer 或真实注册验收。HTTPS 客户端以显式 CA 校验证书，34/34：注册关闭、四账号登录与 Secure/HttpOnly/Lax cookie、session、预期账号 200/403、admin/member 目录权限、媒体 Range/字节、native32 快捷句和画布/公开分享/撤销/owner 隔离。
- 另 15/15：UUID/native32 团队目录、1px PNG 上传/原字节下载/跨账号拒绝、真实 WSS welcome、改密后旧密码/会话拒绝、心跳关闭 `1008 session expired`、新密码登录、logout 与撤销。最初团队 400 是隔离挂载缺 `topics.json`；复制既有 `lib/production-lab/topics.json` 后补验成功，保留初次失败日志，没有重启 Gateway 或修改生产代码。
- 浏览器实际提交 native32 登录表单，进入打包首页及原画布；影片 3840×2160、readyState=4、自动播放，1558×819 无横向溢出、资源无外部 origin。首次改名发现新增 P1：合法最小 `create_canvas` 缺 `chatSessions`，generation persistence guard 直接 `.some()` 抛错；首轮补 guard 后进一步暴露本地 storage rebase 的 `.map()` 和旧 recovery journal 恢复失败，不能将画面更新或单次 HTTP 200 当作修复完成。
- 已修根因：在远端 snapshot/GET、本地持久文档和 recovery journal 的读取边界，统一仅为缺省的 `chatSessions` / `previsScenes` 补空集合；不静默替换错误类型，不改远端 revision、hash、mutation ID、journal token 或 owner。304 保留已核对对象。没有清除 IndexedDB/localStorage 或用新画布绕过旧状态；原失败 journal token=15 正常合并落盘并确认收据，最终 journal 数为 0。
- 最终真实浏览器闭环通过：原画布 UI 改名、新建文本、编辑→服务端读取→无缓存刷新恢复；断网编辑时 IndexedDB 已写（storage revision=17、cloud revision=5），联网后自动补传到 revision=6，再刷新仍一致，UI 显示“已同步”，最终本地 storage revision=19、远端/本地各 1 个同 ID 文本节点，没有重复节点。最终刷新后 console error/warn 为 0、资源无外部 origin；未触发模型生成。
- 本轮验证：Web 目录 `bun test test/canvas-persistence-loss.test.ts test/canvas-mutation-batches.test.ts test/canvas-sync-recovery.test.ts test/canvas-draft-persistence.test.ts test/canvas-generation-task-sync.test.ts test/canvas-conditional-get.test.ts test/canvas-sync-rebase.test.ts test/canvas-import-storage.test.ts test/generation-storage-consistency.test.ts` 共 56/56、6929 assertions；四个改动 TypeScript 文件 ESLint 通过。inline 最小文档断言核对 snapshot/GET/conditional GET/本地 rebase、hash 不变/源对象不变/304 identity 保留，通过（不是新增仓库测试文件）。最终原 Web Docker build（含 TypeScript 和内置 gate）exit 0，22.48 秒；仅核实 project/service labels 后重建本任务 Web，healthy。
- 证据在同一 Git ignored runtime 的 `compose/evidence/backend-fixture-fix-rebuild.json`、`full-stack-up.json`、`tls-ingress-up.json`、`https-business-results.json`、`https-session-media-results.json`（初次失败）、`https-session-media-topics-fixed-results.json`、`browser-before-chat-sessions-fix.json`、`web-chat-sessions-rebuild.json`（首轮 guard-only）、`web-collection-normalization-rebuild.json`（尚缺旧 journal 恢复）、`web-journal-normalization-rebuild.json`、`browser-canvas-persistence-results.json` 及 `compose/logs/`。运行凭据位于不挂载进容器的 `private-fixtures/`，权限 0600；复用命令见 `commands.txt`，inline smoke 结果不是完整可重放 harness。

### 未关闭缺口（静态与动态结果分开）

- Backend 构建 gate 已关闭，隔离整栈启动与正常 HTTPS/WSS 业务已补验；不能将 synthetic NAS/数据、测试证书、dirty 镜像当作生产发布门槛关闭。
- P1：本地客户端 IP/可信代理代码、双来源限流与反伪造已关闭，见 2026-11-17 专节。目标生产入口与可能存在的额外代理拓扑尚未核验；必须按实际连接来源配置可信地址并复验，不能照搬任务临时 IP 或信任共享网段，不把本地通过冒充生产限流验收。
- Support：非 Next HTTP adapter、native session/UI、32hex owner 与旧 UUID 源隔离已完成本地实现及真实 HTTPS/浏览器验收，详见上方专节；未配置时仍安全关闭。真实 worker、模型/产品取证、历史队列保留和生产部署配置仍待验，不以合成终态反馈或排队成功关闭完整能力门槛。
- 真实 Linux.do/邮件/SMS 联调、生产历史业务数据与媒体、旧 groups 覆盖、实际模型生成、NAS/storage guard/自动部署/监测报表、生产 TLS 切流与回滚仍未验收；需相应配置、脱敏数据副本或针对生产操作的授权。本地代码修复与 mock/synthetic 通过不等于生产门槛关闭。
- 本轮仍未 commit/push、部署或切流，未操作生产守护任务；原分支与其他项目服务未改动。隔离 Compose 四类业务镜像已构建，migrate/Backend gate 通过，完整 native stack 已运行；不将本地结果扩写成生产可上线结论。

## 主站退役候选边界

- `feature/main-site-migration` 保留本地 native 认证、独立编排与运维候选及 3 个旧用户迁入记录；本分支候选未生产部署，不代表完整主站退役或生产账号、历史业务数据迁移完成。
- 合并阶段仅合并 main 的最新代码与目录迁移；本次 worktree 仅对隔离 synthetic 库执行验收，不执行真实账号迁移、部署或守护任务切换。独立助手的已上线状态以下述实际 release 记录为准，不与本分支候选混同。

## 三服务取证上线（2026-11-16）
- 用户以“允许。提交代码”明确授权本次仅停止/启动 com.fgstudio.support-bot-worker。首次检查有1条 processing，未切换；等待工单处理结束后，在 support_bot_jobs SHARE 锁内确认 pending/processing 均0，再切换至 clean commit `3b07ab8002222003f05bfeec4d500228c35949b1`。启动事件、源码、release、单进程树及稳定 PID 均吻合，stderr 无事件；保持 production/web-only、SUPPORT_BOT_SEND_ENABLED=false。
- 候选执行 `scripts/support-bot-worker.ts --check`、worker 模块加载及既有历史问题检查均通过；`scripts/support-bot-preflight.ts --require=yingce-web,yingce-gateway,canvas,yingce-agent,adcraft,meilin,suno` 保留完整7项，Web/Gateway/Canvas/Agent 通过，三产品 gateway 数据接入均可用。AdCraft/旧 Meilin 原生缺口准确标记 native_product_retired；Suno contractReady=true、sampleVerified=false，仍为 native_product_log_sample_missing；不冒称完整原生预检通过，也未制造业务样本。
- 新独立源码保留当前 Web/Gateway/Canvas/Agent 的运行 commits、完整 tree objects 及 refs/support-runtime 引用；未修改生产主仓。Git bundle 直接传独立助手，未 push main，避免连带发布主业务。
- `check.py`、`postcheck.py` 通过；47个运行/停止状态容器的 ID、image、启动时间、重启次数、运行状态均未改变，其他守护任务加载/禁用状态及生产主仓 HEAD/工作树未变；Web/Gateway/Canvas 运行版本复核一致，主站版本接口 HTTP 200。没有恢复退役服务或改动其他守护任务。
- 发布及回退产物：`/Users/server/work/fg-support-production/releases/support-20261116T032449Z-3b07ab80/`，含 deployment-result.json、队列/服务基线、worker.previous.plist；旧源码与 release 保留。真实业务 E2E、真实工单提速未验收；先前本地12/12测试中的日志落库连接告警仍不算落库验收。

## 三服务缺口继续处理（2026-11-16，发布前记录；后续已上线见上节）
- 按用户继续处理的要求，已核对生产环境标记、目标库 fg_yingce 与实际 worker 角色 fg_support_readonly，在事务中仅授予 fg_meilin_dramas / fg_meilin_events 各5个元信息列的 SELECT 权限；没有授予 document/detail 正文读取或任何写权限。用 worker 原配置实际读取了本人2个剧目及2条 create 事件、另一账号历史调用/事件；跨账号指定剧目返回0，正文读取权限和表写权限仍为 false。
- 纠正此前“服务仍有人使用/上游异常”的不完整判断：历史操作不代表当前在线。生产容器、实际 gateway 退役路由及 Compose profile 均确认 AdCraft/旧独立 Meilin 已退役；相关容器最后停止时间为2026-11-11 22:53（Asia/Shanghai），不是本轮停止。不启动退役服务。助手遇到原生503/504等失败后，只读核对固定公开入口的 HTTP 410 + FG_MODULE_RETIRED，明确 native_product_retired，继续支持可授权的历史记录，不把退役当运行故障。
- 核对运行 gateway 的 fg-music-queue.mjs、fg-retired-modules.mjs：统一 CRLF 后文件摘要与本地一致。Suno fg_music_jobs 是人工音乐制作队列；queued 等待管理员领取，processing 制作中，importing 归档中。新增 operatorAssigned 布尔值，不返回操作者身份；真实排队记录为未领取。创建队列只查 /status，不调用自动生成，故没有原生生成日志不能推断漏采，不制造预检样本。
- 生产只读候选验收：AdCraft 4项提交且识别 retired；旧 Meilin 历史剧目/事件/调用均可读取并识别 retired；Suno 排队记录可读。三服务 gateway.available 均 true；原生整体 ready 仍未全部通过（退役产品无在线原生证据，Suno 缺真实原生请求样本），没有以历史查询成功冒充运行版本/原生日志闭环通过。
- 本地 `pnpm exec tsc --noEmit --incremental false --pretty false`、`git diff --check` 通过；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts` 12/12 通过，仍有日志落库连接告警。未新增测试代码、未调用模型/生成歌曲、未 commit/push、未修改生产代码或重启任何守护进程。用户随后以“允许。提交代码”明确授权本次仅在队列空闲时切换 com.fgstudio.support-bot-worker；其他服务不动，失败恢复旧版。发布结果另行记录。

## 三服务补充取证（2026-11-16，初次实现记录；后续已上线见上节）
- AdCraft、旧独立 Meilin、Suno 的 operations 并行读取原生证据与同账号/同时间窗的 gateway 持久化记录；标注真实来源，原生失败仍保留缺口。增加本人 AdCraft 工作区、旧 Meilin 未删除剧目及本人事件元信息；不读取 brief/document/detail，不把 queued/submitted 当作生成成功。日志入口仍仅查询原生日志。
- gateway 按服务隔离产品表，逐列检查 SELECT 权限；缺权限只跳过该来源，不丢掉已有可读调用记录。Suno 预检区分契约可读与日志样本缺失，保留原整体 ready 门槛，单列 gateway 能力。
- 本地 `pnpm exec tsc --noEmit --incremental false --pretty false`、`git diff --check` 通过；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts` 12/12 通过，仍有日志落库连接告警，不算落库验收。
- 候选 adapter 打包后仅通过 stdin 在生产 worker 原环境执行只读查询，未写入或替换生产代码：读到 AdCraft 4项提交、旧 Meilin 2项历史调用、Suno 1项排队记录；跨账号同任务返回0，不支持 trace/session 或非法时间未扩查，logs 未混入 gateway 记录。无模型调用、真实生成或通知。
- 首次验证时的接入限制（后续处理见上节）：AdCraft/旧 Meilin 原生接口不可用；当时 support 角色没有 fg_meilin_dramas/fg_meilin_events 所需列权限，新增元信息取证尚未在该角色下验收。README 当时已提供仅元信息列 SELECT 授权步骤，尚未执行 GRANT。Suno 原生接口契约可读但所查账号近7天无日志样本，仍不算完整预检通过。本轮未 commit/push、部署、重启或修改生产权限。

## 业务运行源码补齐（2026-11-16 10:35，Asia/Shanghai）
- 复查发现网页已更新至 `a5b221e8f9cdcf3c18649ed3ddb2bb8d747536b2`，但独立助手仓库没有该 Git 对象；11月13日助手上线时核对的网页为 `7ac1bb4e`，后续业务发布未同步到助手。运行时仍禁止自动 fetch，不以旧实现冒充新版本。
- 按用户“现在更新一下”授权，仅从生产主仓向当前助手仓库 fetch 上述提交及完整对象，保留为 `refs/support-runtime/yingce-web/a5b221e8f9cdcf3c18649ed3ddb2bb8d747536b2`。使用 `--no-auto-maintenance --no-tags --no-recurse-submodules --no-write-fetch-head`，未切换 HEAD、修改 origin、工作树或 plist，未重启任何服务。助手 HEAD 仍为 `8bc86308`、PID 仍为87916；生产主仓 HEAD 与工作区前后相同。
- `git rev-list --objects --no-object-names --missing=print a5b221e8f9cdcf3c18649ed3ddb2bb8d747536b2^{tree}` 核实树对象完整；通过原 worker 环境执行 `scripts/support-bot-preflight.ts --require=yingce-web,yingce-gateway,canvas,yingce-agent`，退出0，四项均 ready，网页源码状态恢复 `commit_source_available`。该验收仅针对当前美林四项，不代替原7项整体覆盖验收。
- AdCraft/旧独立 Meilin 的取证接口仍不可用，Suno 仍缺预检账号日志样本；未声称这些缺口已修复。本次仅补齐现有运行版本源码，没有新增自动同步机制，后续业务升级仍需同步对应提交。未创建真实工单、调用模型或提交/push 文档。

## 排查性能优化上线（2026-11-13 11:38，Asia/Shanghai）
- 用户明确允许本次仅停止并重新启动 `com.fgstudio.support-bot-worker`，失败时恢复旧版。已在助手队列表 `SHARE` 锁内确认 pending/processing 均为0后切换，PID 24310 → 87916（子进程87919）；等待旧任务真正卸载，再验证新版单一进程树、实际源码目录、启动 commit/release 及稳定 PID，production/web-only 保持不变。
- 发布 `support-20261113T032712Z-8bc86308`，commit `8bc863086531be34f3e8196721a6402deed141c6`，`dirty=false`；37项文件摘要通过，快照摘要 `668a2fa8349a3f362d43a8318e5a867fb313ba7af550c4ecb95609a9731cba90`。复用有效复核、批量规划最多4项独立只读查询、提前传递答案证据限制；没有降低思考等级、放宽证据校验或修改整轮失败重试策略。
- 沿用既有依赖及生产助手专用配置，未安装依赖、迁移数据库或部署主业务。只向候选助手仓库补齐生产 Git 对象；线上 Web/Canvas 为 `7ac1bb4e`，Gateway 为 `f1d1528e`，逐服务匹配源码与运行身份，不以助手 commit 冒充业务版本。
- 实际执行候选 release 的 `prepare.py`、`check.py`（含 `scripts/support-bot-worker.ts --check`、worker 模块加载、既有历史问题匹配及新旧 worker 的7项 required 预检）、`capture-baseline.py`、`deploy-guard.cjs`、`postcheck.py`。Web/Gateway/Canvas/Agent ready；旧独立 AdCraft/Meilin 不可用、Suno 原生数据/日志覆盖不足，整体 `ready=false`，新旧预检没有新增覆盖回归。首次启动 guard 的包装参数不匹配 `/usr/bin/env`，在执行 guard 前即失败、未操作服务；按 plist 原有环境前缀修正后完成唯一一次切换。
- 切换后19个业务容器的 ID/image/启动时间/重启次数不变，其他守护任务加载状态及 disabled 清单不变；生产主仓 commit `f1d1528e689a561164fb022d2ffb1ceef80a8f9e` 和工作区未变。新版启动事件一次、stderr 为空；业务原生版本核验通过，主 App `/api/version` HTTP 200。未恢复显式禁用任务。
- 上一 release `support-20261112T050834Z-30a93b80-worktree-a3d15cc69093`、源码及 `worker.previous.plist` 均保留。部署证据与回退产物位于生产 `/Users/server/work/fg-support-production/releases/support-20261113T032712Z-8bc86308`，`deployment-result.json` 状态为 `deployed_with_coverage_gaps`。未创建真实工单或调用真实模型，因此未宣称实际耗时降幅；Web API/Canvas 前端不在本次发布范围。

## 排查补查与最终报告优化上线（2026-11-12 13:12，Asia/Shanghai）
- 用户明确回复“允许”本次仅重启 `com.fgstudio.support-bot-worker`。在助手队列表 `SHARE` 锁内确认 pending/processing 均为0后，等待旧任务真正卸载再启动新版；PID 43094 → 24310，子进程 24312，单一进程树、实际源码目录及启动事件匹配，保持 production/web-only，未开启飞书外发。
- release `support-20261112T050834Z-30a93b80-worktree-a3d15cc69093`；基线 commit `30a93b802f441cf0ac05ccc6c255c2eef98a4bde`，`dirty=true`，快照 SHA-256 `a3d15cc690937876c801f5d28f1620f98479bf5bb7b54cd5897b9df5ecbb26fd`。仅叠加 `lib/support-bot/diagnose.ts`、`payload.ts`、`report.ts` 三个运行文件，37项文件摘要通过；没有 commit/push、安装依赖或修改数据库结构。Web API、客户端 SSE 及 Canvas 前端等其他工作区修改保留但未发布。
- 新版允许分析阶段继续补查，增加工具额度并补齐可用请求/响应分页；未完成的取证或分析失败交由既有队列重试，不把“尚未查清”等中间状态保存为已完成结论。证据缺失仍需明确说明，不承诺所有问题都能确认根因。
- 生产实际执行 `scripts/support-bot-worker.ts --check`、完整 worker 模块加载、既有历史问题匹配校验，均通过。旧版与候选均按原7项清单执行 `scripts/support-bot-preflight.ts --require=yingce-web,yingce-gateway,canvas,yingce-agent,adcraft,meilin,suno`：Web/Gateway/Canvas ready；Agent 缺匹配环境日志、旧独立 AdCraft/Meilin 不可用、Suno 原生数据/日志覆盖不足，整体仍 `ready=false`，与旧版相比没有新增覆盖回归。
- 仅向候选助手 Git 仓库补齐实际业务运行提交对象；发布后 Web/Canvas 运行提交核对为 `511bab53566e57ce76b7b64c4db21b4b40ddd905`，Gateway 为 `a9075b714bc6fbea5465239cb748638e09e4ad74`。18个业务容器的 ID/image/启动时间/重启次数不变，其他守护任务加载与禁用状态不变，生产主仓 `738b11edb2a1316c756b8dec2bf678a42fc8d34c` 及工作区不变；业务版本接口可用，主 App `/api/version` HTTP 200。新版启动一次，核验时 stderr 为空；没有恢复已禁用任务或测试网关。
- 优化阶段已通过 `pnpm exec tsc --noEmit --incremental false --pretty false`、`pnpm exec tsx --test tests/observability/server-log.test.ts`（2/2）；部署阶段执行文件摘要、模块/存储/版本及健康检查，并运行 `git diff --check`。未新增测试或调用真实模型/生成业务，真实工单端到端效果尚未验证。旧 release/source/plist 完整保留，发布证据及回退配置位于生产对应 release，最终状态为 `deployed_with_coverage_gaps`。

## 合并至 main（2026-11-12，Asia/Shanghai）
- 按用户要求，将助手分支 `a534293a` 合并到以远端 `15ce2ac9` 为基线的 main；保留 main 的美林目录迁移及其他主业务更新。冲突仅涉及状态文档、README 和助手实现，合并后的 `lib/support-bot` 与预检脚本和已上线分支一致。
- 本轮验证：`pnpm exec tsc --noEmit --incremental false --pretty false` 通过；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts` 通过（12/12）；`git diff --cached --check` 通过。既有日志测试仍出现异步持久化连接告警，不作为数据库落库验收。
- 生产自动部署任务只读核验为显式禁用，未启用或重启；本轮不执行部署，线上版本不因本次合并而改写。旧 `production-lab/yingce` 下的本地未跟踪缓存保留，不纳入提交。

## 授权后上线与当前业务源码适配（2026-11-12 09:42，Asia/Shanghai）
- 用户明确允许本次仅停止并重新启动 `com.fgstudio.support-bot-worker`；在助手队列表 `SHARE` 锁内确认 pending/processing 均为0后切换，旧 PID 54035 → 新 PID 43094。没有中断在途工单，没有执行其他服务的停止、重启、启用或禁用操作；本次授权不能延用于后续重启。
- 生产运行代码已迁移至 `production-lab/meilin`，前端身份改为 `meilin-web`，Gateway/Agent 仍沿用既有服务标识。提交 `b983581f68961d7735fc555a68282872574859fe` 补齐新源码路径和明确的网页身份别名；保留仍在线旧 Agent 的 Yingce 源码路径，旧独立 Meilin 与当前画布分开。环境、commit、dirty、跨服务身份及证据归属校验没有放宽。
- 前一候选源码目录在本轮激活前已缺失（原因未调查），先用原 Git bundle 校验恢复；随后因线上目录迁移被新 release 取代，旧候选标记 `superseded_before_activation`，从未激活。新 release 从 clean commit 构建，36项文件摘要通过，仅向助手自身 Git 仓库补入当前业务运行提交对象，没有更改生产主仓 checkout 或安装依赖。
- 本轮本地验证：`pnpm exec tsc --noEmit --incremental false --pretty false`、`git diff --check` 通过；终端 `pnpm exec tsx -e` 内联20项断言验证新旧源码归属、网页新旧身份、异服务/错误环境/缺失commit拒绝，mock fetch 不联网，不新增测试文件。前轮12项既有测试及历史/报告/编排检查结果保留，不冒称本轮重复执行。
- 新发布目录执行 `scripts/support-bot-worker.ts --check`、模块加载与历史问题001/002匹配均通过；原7项 required 预检未缩小。网页 `15ce2ac9`、Gateway/Canvas `a9075b71` 的运行身份、生产构建与对应源码均已核对，通过了上线前旧 worker 与候选的覆盖差异检查；未以单纯进程存在代替版本核验。
- 切换后 `postcheck.py` 验证真实 source、启动 commit/release、单一 worker 进程树、稳定 PID、无 stderr；另实查当前网页/Gateway/Canvas 版本接口均 HTTP 200。以本轮切换前18个运行容器为基线，ID/image/启动时间/重启次数未变，生产主仓 commit `15ce2ac9` 和工作区未变；12个已有守护任务的加载状态未变。auto-deploy/report-scheduler 在切换前已未加载，本轮未操作它们，不将“状态未变”表述为所有守护任务正常。
- release 的 `deployment-result.json` 已为 `deployed_with_coverage_gaps`、`activated=true`。Agent 没有匹配环境的业务日志；旧 AdCraft/独立 Meilin 接入不可用；Suno 原生数据/日志覆盖不全，整体预检仍 `ready=false`，没有恢复退役功能或把上述缺口隐瞒。未新增真实工单或调用真实模型，完整用户问题效果仍待验收。
- 上一在线 release `support-20261111T092940Z-2cee6080-worktree-4a11e9729b69`、其源码与 `worker.previous.plist` 均保留。若另获回退授权，只切换助手并复核实际旧 PID/源码/启动事件，不回滚主业务或数据库；私密 env/日志留在生产 release 目录，不进入 Git。

## 通俗回答与历史问题参考（2026-11-11）
- 用户答复改为“是什么/影响什么/怎么做”，必要风险与未确认说明仍保留；原始证据、代码/版本、请求/响应对照和完整覆盖缺口保留在内部报告，不减少查询或深度分析，不以硬截三步丢弃必要操作。
- 当前问题理解后并行检索发布目录的 `docs/user-issues.md`，最多3条现象相似案例；去除人员、署名、截图和链接，保留待处理状态、适用条件与付费风险。历史仅作线索，不进入本次事实证据；缺失、取消、超限等失败不影响正常调查，不新增模型调用。未改写用户创建的历史文档和截图。
- 验证：`pnpm exec tsc --noEmit --incremental false --pretty false`；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts`（12/12）；`git diff --check`。既有日志测试有异步持久化连接告警，不能当作数据库落库验收。
- 终端内联断言（无新增测试文件）：真实文档的过期/声音相似项、无关泛词、状态/条件保留、人员/密钥脱敏、缺失/超限/取消/符号链接拒读；15个报告分支覆盖 confirmed/observed/likely/needs_info、模型非法答案回退、素材与声音、四步保留、参数对照校验、内部技术详情和历史不冒充证据；三种文档状态的隔离编排验证取证先于历史读取完成、模型调用仍3次、换题不带旧问题。
- 未调用真实模型、生成业务或生产队列；真实用户问题的完整模型效果仍需线上验收。无数据库迁移、依赖或业务功能变更；回退仅需回到上一助手 release，不回滚主业务。

## 上一轮独立发布准备（2026-11-11 18:19，Asia/Shanghai）
- 代码提交 `46b22f8aaaca6a8f67b09ac12356bb09c4c98869` 已推送 `origin/codex/support-plain-language-history-20261111`；当时 remote main 为 `fc7b954f`，不通过主站自动部署发布助手。用户创建的历史文档和截图保持原内容，并包含于此次候选提交。
- 候选 release `support-20261111T101603Z-46b22f8a` 位于生产独立助手目录的 `releases` 下；从已提交代码构建 clean checkout，36项助手/配置/历史文档摘要通过，没有安装新依赖。生产旧 worker、现有 plist 和生产主仓未替换；新 env/plist 仅写候选目录，保留旧配置用于获准切换或回退。
- 已实际执行候选 `scripts/support-bot-worker.ts --check`（仅 schema）、worker 模块加载（不领任务）、历史文档匹配（001/002及未确认状态），均通过。`scripts/support-bot-preflight.ts --require=yingce-web,yingce-gateway,canvas,yingce-agent,adcraft,meilin,suno` 保留原7项 required：Web/Gateway/Canvas ready，Agent 缺业务日志、AdCraft/Meilin/Suno 原生数据/样本覆盖不足，整体仍 `ready=false`，未放宽验收清单。
- 准备前后22个容器的 ID/image/启动时间/重启次数不变，旧助手 PID 54035 和已加载 plist 不变。当时 release 的 `deployment-result.json` 为 `prepared_pending_worker_restart_authorization`、`activated=false`；**这是准备完成，不是新版已上线**。
- 已向用户说明：需等当前工单完成，在空队列保护下仅停止并重新启动助手，期间新问题短暂等待；其他服务不动。当时尚无本次明确停止/重启答复，因此未执行激活；2026-11-12 获得明确授权后的重新核验与实际结果见上方上线记录。

## 本轮独立 worker 部署（2026-11-11）
- 按用户“先部署”的要求只更新既有助手；release `support-20261111T092940Z-2cee6080-worktree-4a11e9729b69`，基线 `2cee6080d0dc1587247a60b6cae76e1d6646a72c`，`dirty=true`，快照 SHA-256 `4a11e9729b69575e192dda3958d2f84d2547e6bf94e542bcfe50753e3b6575ba`。不是新的 clean commit，也未包含其他任务的两个 untracked 文档。
- 等已有工单结束并在空队列锁保护下切换 `com.fgstudio.support-bot-worker`；新 PID 54035、子进程 54079，实际路径及启动事件匹配 release，仍为 production/web-only，未开启飞书外发。首轮遇到 launchd 异步卸载导致的即时状态误判，补充 bootstrap 恢复旧 worker 后修正等待逻辑再切换；无在途工单被终止，原 plist/source 保留。
- 生产 `scripts/support-bot-worker.ts --check`、完整 worker 模块加载通过；按原七项运行清单执行 `scripts/support-bot-preflight.ts --require=yingce-web,yingce-gateway,canvas,yingce-agent,adcraft,meilin,suno`，未缩小 required：七项运行版本/源码均核对，Web/Gateway/Canvas ready；Agent 无匹配业务日志，AdCraft/Meilin/Suno 原生数据或样本覆盖不足，整体仍 `ready=false`。本次是有限能力更新，不是全服务验收通过。
- 本地再次运行本节下方所列 tsc、12项既有测试及 diff 检查，全部通过；生产复核 22 个容器的 ID/image/启动时间/重启次数不变、其他守护任务加载状态不变、主站 `/api/version` HTTP 200。新 worker 启动一次且 stderr 为空；未用伪造工单或付费生成补验收，真实模型端到端仍未验证。
- 生产 release 目录保留清单、文件校验、预检、首轮恢复记录与 `deployment-result.json`；最终状态 `deployed_with_coverage_gaps`。具体能力范围与上线边界见 README 的生产配置部分。

## 本轮全仓源码与参数对照（2026-11-11）
- 源码与日志范围解耦：全仓安全文本可检索/读取，包含共享及历史 `app/lib/components`；业务数据与运行版本仍拒绝废弃主站。共享文件读取使用本次调查服务的源码 revision，不用历史目录命中证明服务实际调用。
- Canvas `detail` 真正读取已授权记录的任务输入/结果、调用请求/响应，重新校验 active 映射、任务和项目归属及关联编号变化；复用只读事务与超时，不恢复原始正文到模型。不再只返回元数据缓存。
- 参数投影保留安全 prompt、自定义参数、数值和响应字段；嵌套/序列化 JSON、认证键值对、签名 URL、凭据和媒体继续保护。128 Ki 字符读取上限、24字段片段/6,000字符分页，长文本先脱敏再分段；窄字段读取不能冒充整份完整，同一脱敏快照的续页可合并核验。
- 生成调用审计不再限定 create/upload：查询全部已记录阶段，最多64条，创建/上传优先，其余阶段取最新记录；创建核对与完整审计分别标记。主动读取历史输入、失败/创建/最新回执参数，再结合源码独立分析，新增 parameterReview 引用和对照校验；缺页、未采集、其他服务只有元数据均阻止冒认完整根因。
- 本地验证：`pnpm exec tsc --noEmit --incremental false --pretty false`；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts`（12/12）；`git diff --check`。测试输出仍有异步日志持久化连接告警，不代表真实落库通过。
- 无文件终端隔离检查通过：commit/working-tree 的 app/lib/Yingce 源码读取和路径保护；参数保留、嵌套脱敏、JSON Pointer 防绕过、长文本分页/完整性；只读事务约束、归属重验、关联变化拒绝、缓存门禁、匿名/主站拒绝，以及参数审阅校验和答复输出。数据库适配器检查用内存替身，未连接数据库，不能代替实际 SQL/权限与线上验收。
- 边界：仅修改助手及其预检/文档，没有新增依赖、schema、测试文件或业务采集。其他服务没有请求/响应正文时明确 not_available，未采集/已删除的历史正文无法恢复；全服务参数能力尚未完成。实现阶段未重新核验生产或调用真实模型；后续独立 worker 部署与预检结果见上节。

## 本轮分流与深度分析重构（2026-11-11）
- 范围纠正：用户是在确认是否包含 Yingce，不是要求排他性收窄。撤销仅四项/仅 production-lab/meilin 目录的限制，恢复其他产品、基础设施和源码定位；分类与默认值不将其他问题强制归为 Yingce。仍遵守不查询废弃主站及旧 Production Lab 主站模块，保留身份/工单存储。
- 纠正验证：`pnpm exec tsc --noEmit --incremental false --pretty false`（输出 `/tmp/fg-support-multi-service-types.log`）与 `git diff --check` 通过；终端隔离检查确认 Yingce/AdCraft/Suno 在 commit 和 working-tree 均可检索/读取，其他产品分类与工具入口保留、废弃主站仍拒绝。预检隔离检查覆盖默认九项业务服务、五产品探针、显式其他产品选择及缺口失败；未连接真实数据源、未调用真实模型或部署。
- `question.ts` 区分 usage/help/generation/incident、续问与换题；当轮明确编号覆盖旧对话/页面线索，多个编号独立根查询，用户明确排除的旧编号不再采用。使用/帮助由程序限制为源码及运行边界查询。
- 取证模型不再直接发布结论；先做授权链路、生成输入与具体实现核对，再进入单独的 high-or-higher 综合分析，16,000 tokens 输出预算；私有思维过程不展示。同参数取证去重，缺失/截断/未关联编号写入覆盖缺口，阻止完整根因确认。
- 修复 FG/Production Lab 默认84天窗口被二次当作7天显式窗口拒绝的问题；接通 FG 日志 cursor，同归属范围有界续页；保留各来源覆盖、输出裁剪和预算耗尽原因。顶层记录不再静默被50项数组上限裁掉，内部图关联与对外展示分别限制。
- 已授权链路返回的生成 taskId 会补查历史输入、创建/上传审计和相关实现；审计保留 request/trace/provider 编号与时间。providerRequestId 不当作 requestId 别名。其他调用阶段由 chain 查询，缺失历史不补造。
- 安全收口：未绑定受信 FG 身份的飞书等入口不能仅凭编号读取私有操作/日志/详情/链路，仍可获得源码帮助；已登录网页按本人身份取证。跨服务任务关联按服务保存，不用全局同名 taskId 作为根因关联。
- 验证：`pnpm exec tsc --noEmit --incremental false --pretty false`、`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts`（12/12）、`git diff --check`。既有日志测试仍出现异步持久化连接告警，不能作为落库成功证据。
- 隔离调用检查（终端内执行、不新增测试文件、不联网/查库）：三类编号分别作为查询根；换题清除旧编号；help 不执行日志查询；最终单独 high/16,000 综合分析；明确排除旧编号/多个任务编号/无空格编号；生成审计标识与时间保留；取证缺口拒绝 confirmed；FG 84天范围与两页 cursor 均保留本人过滤，60条记录完整进入展示，未绑定身份拒绝私有取证。
- 边界：没有新增依赖、迁移或仓库测试；未调用真实模型、写生产、操作守护任务、commit/push/部署。来源未接入、历史留存不足或有界预算耗尽仍会明确显示缺口，不能宣称任意任务全链路都可完整恢复。原生产源码/发布 checkpoint 保留，真实模型效果需另行验收。

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
