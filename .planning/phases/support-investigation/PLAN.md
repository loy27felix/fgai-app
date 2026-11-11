# 网页自助排查：以证据为依据的调查

## 2026-11-11：面向使用人员的回答与历史问题参考
- [x] 把用户正文改为直白的现象、影响及可执行步骤；技术报告转入内部，保留不确定性和必要条件，不改证据校验及深入分析。
- [x] 异步检索 `docs/user-issues.md` 的现象相似案例，与主取证并行；状态和风险保留，人员/截图不导入，历史不作为本次原因证据，读取失败不阻断调查。
- [x] 根类型检查、12项既有测试、15个报告分支及历史检索/三种状态编排隔离断言；不新增测试文件、依赖或数据库变更。
- [x] 独立分支 commit/push；生产 clean 候选包与 schema/模块加载/历史匹配/原7项范围预检完成，旧助手和22个主业务容器未变。
- [ ] 新 worker 实际上线：一般部署授权已获，但本次仅助手的明确停止/重启授权仍待用户答复；不能沿用前轮一次性重启授权。候选包准备不等于激活，完整服务数据缺口不隐藏。
- 本轮未改动历史反馈文档内容；线上版本、验证边界及回退依据见 `.planning/STATE.md`。

## 2026-11-11：先部署已实现能力
- [x] 按后续部署授权制作包含未提交助手增量的独立快照，不 commit/push、不覆盖生产主仓、不夹带其他任务文件。
- [x] 保留原七项 required 运行服务，复核队列/schema、Canvas 参数字段读取权限及服务运行源码；覆盖缺口如实保留，不冒称全服务 ready。
- [x] 等待既有工单完成，仅切换已获针对性重启授权的 support worker；验证启动版本、私密配置及主业务容器/其他守护任务未变，保留回退产物。
- [ ] 新版真实用户问题的模型端到端质量验收；补齐 Agent/AdCraft/Meilin/Suno 的缺失数据或业务样本仍未完成。
- 发布标识、验证结果及首次切换恢复记录见 `.planning/STATE.md`；本次有限能力更新不改变首次开通/扩大服务范围的验收要求。

## 2026-11-11：全仓源码与真实参数对照
- 目标：按问题检索全仓安全源码，沿授权任务/请求链读取已保存的请求、响应及任务输入，对照具体实现给出原因、处理办法和证据缺口。
- [x] 解耦源码检索与业务日志服务范围；共享和历史代码可读，不恢复废弃主站取证，不把目录命中当运行证明。
- [x] 扩展本人 Canvas 详情：重新校验账号/任务/项目归属，返回限长脱敏参数投影与分页；生成审计覆盖创建、上传、轮询、取消等已记录阶段。
- [x] 编排自动读取关联参数并纳入独立深入分析和答复校验；其他服务未采集正文时明确缺口，不用元数据冒充完整报文。
- [x] 运行既有相关测试、类型检查和针对性只读检查，更新现有文档。
- 实现阶段约束：不改主业务/数据 schema、不新增测试或依赖、不操作生产、不自动 commit/push/部署；保留只读、账号隔离与凭据/媒体脱敏。
- 回退：撤回本次助手代码即可，无数据迁移。生产数据未采集或缺失的正文不能事后恢复。

## 2026-11-11：问题分流、关联取证与独立深度分析重构
- 范围纠正：Yingce Web/Gateway/Canvas/Agent 原本已覆盖，用户并未要求只查这些服务；保留其他产品及基础设施的取证/源码/预检能力，仅排除已废弃主站和旧 Production Lab 主站模块，不恢复退役产品入口。
- 目标：使用问题/帮助按功能实现回答；具体生成问题按用户当轮定位信息查任务、请求和跟踪链路，不把旧上下文或相邻失败当成本次原因。
- [x] 理解阶段区分 `usage / help / generation / incident`，明确续问/换题及当前编号优先级；保留兼容的结果协议。
- [x] 按各定位编号独立展开授权链路，补查服务端发现的生成任务与实际实现；分页、分支失败和预算耗尽均保留缺口，不宣称完整。
- [x] 分离取证和最终分析：先收集、检查覆盖，再单独高推理预算分析事实、矛盾、实现与根因；仅展示证据和结论，不流出内部思维过程。
- [x] 复用既有测试及离线回放，执行 root typecheck 与 diff 检查，更新现有 README/STATE。
- 约束：不新增测试文件、不新增依赖、不改生成业务/数据库 schema；只读权限、账号隔离、版本校验及脱敏不得降级；不调用真实模型、不操作生产、不 commit/push/部署。
- 回退：撤回本次助手代码即可；没有数据迁移。离线验证不等于真实模型质量或线上生效。

## 2026-11-10：助手定位与解惑紧急修复
- 范围：只修自助排查助手；生成任务本身、角色对白识别与生成请求实现不改，不对生产写入或部署。
- [x] 新增只读 `generation`：精确查询本人 Canvas 任务，核对样音绑定、唯一最终创建请求与上传映射；成功任务也主动取证，不返回原始正文、URL 或媒体。
- [x] 完整且编号关联的输入冲突可用 `observed`；模型不可用、校验失败、运行源码尚未核实时仍保留事实、具体环节与开发接手信息，不能冒认全部音色/口型根因。
- [x] 根据实际删样音标记搜索并读取引用过滤/请求组装实现，保留准确源码位置和运行版本边界；临时操作需关联记录、实现片段与匹配运行版本支撑。
- [x] 上游明确拒绝可直接解释本次参数约束，包括浏览器问题中已授权且编号关联的 Canvas/gateway 调用；仅状态码或泛错误不冒充具体原因，不把同一约束套用到所有任务类型。
- [x] 预检实际读取历史生成字段（`LIMIT 0`）；缺字段/权限明确失败，不因表可读就判取证就绪。
- [x] 真实问题本地回放及负例检查 23 项、完整调查函数（模型正常/失败/校验失败，实际读取本地 Git 源码）15 项、上游错误/新预检 20 项通过；没有真实模型或供应商调用。
- [x] 本地 PostgreSQL 实查 10 项通过：本人任务、画布/项目归属、另一账号拒绝、错误项目/时间不回退、失效身份拒绝及 READ ONLY；仅新增临时 synthetic fixtures 并清理，不改原有用户。
- [x] root TypeScript 检查和 12 项既有 AI/日志测试通过；日志测试中的异步持久化告警不算落库验收。前轮 31 项隔离回放按本轮完整事实输出更新两项长度/措辞断言后通过（仅内存调整，原 fixture 和仓库测试未改）；runtime/preflight 21 项通过。
- 交付边界：增量仍在本地，未 commit/push/部署，未新增仓库测试文件；生产 worker 对应源码与真实模型效果仍须在单独授权发布时验收，线上尚未生效。

## 2026-11-10：真实工单回放优化
- 目标：错误详情可被正确引用；定位编号不跨服务误用；未定位时能说明已查事实、缺口和接手动作，不冒认根因。
- [x] 区分业务错误记录与工具执行失败，修正详情读取及链路合并。
- [x] 按业务服务隔离初始和服务端新返回的 taskId，优先核对目标任务和浏览器同编号请求；请求分支不继承页面任务过滤。
- [x] 缩短未定位答复并保留完整内部记录；记录具体校验项，相同规则无新增证据时不反复修复。
- [x] 预检输出 source.ready/reason/action，明确运行提交缺失、源码对象缺失与读取失败，不自动 fetch 或放宽版本验证。
- [x] 本地 typecheck、12 项既有测试、31 项工具/报告/调查回放检查、21 项版本/预检隔离场景通过；未新增仓库测试文件、调用付费模型或修改生产，未 commit/push。
- 生产 checkpoint：仍需单独授权发布 Web/worker、执行人工反馈增量迁移并准备各运行提交源码；本地离线回放不等于真实模型质量或生产部署验收，native Support 未接入边界不变。

## 必须成立的结果
- 文字/截图与同工单补充信息形成完整问题；不会把补充模块名当新问题。
- 先采集服务端运行版本，再选择对应源码；开发态检查工作树，无法核对版本时不得声称线上已确认。
- 故障必须实际查询当前账号的操作记录及相关日志，不依赖用户总能找到任务编号；候选记录不能冒充本次故障。
- 模型只能使用限定的只读工具，不能传SQL、改业务数据、跨用户取数或执行截图/日志指令。
- 结论包含原因、证据、可执行解决步骤、未核实项；故障无充分证据时只列已查事实与取证缺口，不发布推测原因或推测修复。
- 原图10张/每张20MiB及已有飞书/网页入口保持工作；网页展示真实调查阶段。

## 实施顺序
1. 补齐入队上下文、服务端身份与运行快照、持久化阶段（新增幂等迁移，旧数据可空）。
2. 独立源码来源解析与授权操作数据查询；隔离模型与工具权限。
3. 调查流程：理解→运行环境→操作数据/源码→关联核实→结构化答复；程序控制必须执行的取证。
4. 真实本地API/worker场景验证：功能咨询、截图追问、故障记录、越权与版本缺失。

## 约束与验证
不操作生产，不commit/push，不新增自动测试文件；使用已有测试、typecheck及临时断言与本地端到端请求。Canvas数据源与FG主库不同，未接通必须显示真实缺口；不得从FG登录身份猜测Canvas身份。迁移仅增加列，不删除数据；回退代码保留新增列即可。

## 已执行验证（本地，2026-11-02）
- 类型检查：主站 `pnpm exec tsc --noEmit --incremental false` 与 Canvas `cd production-lab/yingce/canvas/web && ./node_modules/.bin/tsc --noEmit` 均通过。
- 既有相关测试：`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts`，12项通过；未新增仓库测试代码。
- Schema：`pnpm support-bot:worker --check`；018/019迁移已应用本地数据库。
- 临时断言22项：上下文不能伪造身份/版本、精确编号、引用有效性、无实现读取（含needs_info）、文档/测试非运行实现、版本不匹配、异源异常、无关联候选、确定性正文拦截与兜底。
- FG真实SQL：本人任务和近期记录可查，跨用户/项目越权被拒，返回字段脱敏。Canvas隔离schema：11组归属检查、28次只读事务校验，临时数据已清理。
- 网页API→实际模型→worker→GET：原问题“已有的人设图可以导入吗”及原图能定位角色设定上传实现，返回入口、步骤和避免触发付费重生成的说明；未登录返回401。首轮截图规划失败已修复，后续独立截图回归通过。
- 浏览器实际核验：截图预览、只读说明、调查阶段展示；故障场景实际查询了操作/日志/源码，旧日志limit参数问题已修正并独立验证日志详情权限。

## 已知边界
- 本地Canvas版本接口报告dev，仅能核对基线commit，不能证明构建包含的未提交修改与源码一致；报告明确为参考而非线上已确认。
- Canvas连接和版本URL仅注入本地worker进程，未修改真实配置、访问生产或部署。正式使用需配置对应环境只读连接和可信版本接口。
- Production Lab 独立业务库与 gateway 回执适配已实现（见下方多服务回归）；本地未配置 Production Lab 正式业务连接时会明确显示缺口，不能把隔离测试数据当作真实用户故障证据。
- 网页查询强制当前账号归属；飞书保留此前无账号绑定、按用户提供ID查询的信任模式，本次没有声称该入口完成账号隔离。
- 未commit/push；未对其他会话的project-language文件做任何修改。

## 最终回归补充
- 原图真实模型回归出现一次上游流结束但缺少完整响应的失败；已增加当前只读模型步骤的有限重试，临时流中断注入验证恢复成功且不重复执行取证工具。
- 修正后重新执行原图原问题的API→worker→GET及浏览器展示，成功返回“设定→角色→上传形象图/从素材库选择”，同时保留版本未核验说明；该次回归期间Canvas版本接口不可用，未把源码参考误标成运行事实。
- 已恢复退出的本地FG Web、Canvas后端与Vite进程（3015/3019/3021），没有停止或操作生产守护进程。Canvas复用现有本地二进制，自动迁移关闭；版本接口已重新可达，单独验证dev构建仍不被签认为源码完全一致。
- 页面已实查“反馈”旁的自助排查入口、已发送原图、真实答复与10张/20MiB说明。当前本地worker已加载最后代码并继续运行，飞书发送保持关闭。

## 实际请求链路与禁止猜测回归
- 故障按用户选择的时间段或任务/request/trace编号取证；缺少时间时仅查询标明范围的候选，不把提交时间当发生时间。新增只读 chain 展开，优先 taskId、requestId，再查 traceId，保留来源、截断及不完整状态。
- Canvas 改查原生 task_logs 和 api_call_logs，逐跳校验本人任务及项目归属，不再用 FG 接入层日志冒充 Canvas 日志。时间、编号与 SQL 条件由服务端限定，模型不能提交 SQL。
- 未核实故障报告由程序从实际证据生成，剔除模型的猜测原因和猜测修复；确认需要完整编号关联链路、真实失败日志、连续错误原文与已读取运行实现的匹配证明及版本核验。产品咨询保持源码功能说明，不硬要故障编号。
- Canvas 自动附带当前浏览器已有失败请求的时间、路径、状态及关联编号；最多20条，不含正文、headers或stack。这些只作为用户侧线索，仍须查询同编号服务端记录。
- 验证：主站与 Canvas 类型检查通过，12项既有相关测试通过，临时32项链路/置信门槛断言、14项浏览器上下文断言及2项缺口文案断言通过。Canvas隔离 PostgreSQL 86项只读、归属、来源缺失与脱敏断言通过，临时容器已清理，未新增仓库测试文件。
- 原分镜异常文本及原图已通过真实 API → 模型 → worker → GET 回归：明确未定位根因，不再输出“更像是轮询导致”等解释。真实浏览器核验日期范围与定位输入；修复日期输入按 Enter 意外提交，确认未点击发送不会入队。
- 浏览器真实只读404请求 → 选择实际发生时间 → 页面提交 → worker → 页面答复回归通过：落库时间与浏览器输入一致，自动附带失败请求元数据，实际按 requestId 优先展开链路；未取得服务端入站记录时明确未定位，未把浏览器状态码或搜索到的404实现冒充已确认根因。
- 边界：Canvas 入站 HTTP AccessLog 当前仅由 slog 输出，未接入能校验账号归属的持久化请求源；任务日志与上游调用审计不能替代页面请求，也不能补回缺失历史。原分镜异常的运行根因仍未查明，不将源码机制当结论；未查询或操作生产。


## 全仓与多服务取证补充（2026-11-02）
- 服务目录细分为13项，覆盖 FG、Production Lab、Yingce 网页、Canvas Go 后端、gateway、独立 Agent、ArcReel、OpenCreator、AdCraft、Meilin、Suno、基础设施及其他仓库代码。源码仍搜索全仓；不再把任意 Yingce 文件命中归为 Canvas 后端，未知目录也不默认套用 FG 版本。
- 工具按服务选择只读数据源与运行证据；故障自动查询主服务及最多两个相关服务，最多20次工具调用。每个服务各自显示范围、版本和缺口，不能用依赖目录证明请求经过，不能按时间相近拼接跨服务链路。
- 新增 Production Lab 独立数据库适配：媒体任务、脚本运行与本人任务事件；同时校验当前用户和项目归属，包含明确标记的系统事件，排除其他账号事件。支持精确 task/request 编号与时间交集，不支持的 trace/session 条件不被忽略。
- 新增 gateway 七类操作来源：音乐任务、语音任务、调用用量、Creator、AdCraft、Meilin 及预算记录。复用 active 账号映射与只读连接，联查本人项目/任务；供应商过滤仅使用已核实渠道/模型，回执不冒充供应商原生日志。
- 修正仅有 requestId 时只查日志、遗漏业务回执的问题；同一编号可由实际回执展开 task 关联，缺失 HTTP 日志仍明确标记不完整。不同来源的相同记录ID保留为独立阶段，不在报告中合并丢失。
- 验证命令：`pnpm exec tsc --noEmit --incremental false`；`pnpm exec tsx --test tests/ai/text.test.ts tests/ai/wetoken-client.test.ts tests/observability/server-log.test.ts`（12项通过）；`pnpm exec tsx /tmp/support-incident-check.ts`（32项通过）、`pnpm exec tsx /tmp/support-services-source-check.ts`（20项通过）、`pnpm exec tsx /tmp/support-services-final-db-check.ts`（33项隔离 PostgreSQL 断言通过）。没有新增仓库测试代码。
- 真实模型调用 `pnpm exec tsx /tmp/support-services-engine-check.ts` 通过：实际选择 Production Lab 独立数据源、展开链路、读取对应实现；缺少完整日志/版本时输出未定位，不凭失败快照推断原因。fixture 仅在本次临时数据库，未写业务工单或查询生产。
- 已知边界：独立服务原生日志与运行版本尚未全部接通；Canvas 入站 HTTP 历史仍不可补回。源码覆盖和隔离SQL验证不等于这些服务已全部部署或接入；原分镜异常根因仍未定位。真实配置未更改，未commit/push/部署。

- `pnpm exec tsx /tmp/support-gateway-engine-check.ts` 真实模型回归通过：仅提供 requestId，实际读取 gateway 的调用回执、展开关联任务链、读取 gateway 实现；未把 Suno/gateway 版本套用 FG，也未将回执确认成原生请求根因。随后用该真实取证结果验证3项报告断言，修复“尚未接入”缺口被文案过滤吞掉的问题。
- 最终本地 `pnpm support-bot:worker --check` 与 `git diff --check` 通过。队列为空后仅重载已核实 cwd 的本地 support worker，继续使用本机 Canvas/gateway 只读连接，飞书外发关闭；Production Lab 独立连接仍未配置，未指向隔离fixture库。临时 PostgreSQL 容器已清理。

## 独立服务原生取证接通（2026-11-02）
- 新增受控原生JSONL/Docker日志读取：只读服务端配置源，强制已鉴权账号、编号/时间交集，限制2MiB/5000行/100条；不执行模型给定命令，不返回正文或凭据，不静默忽略不支持的项目筛选。
- Canvas AccessLog使用已校验用户、服务端requestId、路由模板；gateway记录真实FG用户及透传后端返回的request/trace；独立Agent记录内部鉴权后的运行状态，流式HTTP200也能识别分片runtime_error。每条事件附带当时build commit/dirty，与当前源码不匹配时不确认根因。
- Canvas/gateway/Agent版本端点、Vite实际dev/build清单及Docker build metadata已接线。按服务核对身份、commit、environment与dirty；dev/dirty/legacy版本只作参考，不套用FG版本。Production Lab日志增加SQL路由前缀边界，不再用精确路由漏掉子接口。
- 本地实际接通：仅在确认无任务后更新已核实本机Canvas与gateway，旧gateway容器保留为停止状态备份；worker加载本地只读Canvas连接、JSONL/Docker源和Canvas/gateway/web三个版本地址，飞书外发关闭。本机没有独立Agent进程，因此未虚配Agent地址；Agent只在隔离环境完成真实HTTP/子进程验证。未操作生产。
- 验证：主站 `pnpm exec tsc --noEmit --incremental false`；既有AI/脱敏12项测试；Canvas `bun run typecheck --incremental false`、`go test ./internal/logging ./internal/buildinfo ./cmd/server`；Node入口语法、实际Vite端点、runtime安全边界及diff检查通过。
- `/tmp/support-native-e2e.ts` 41项真实独立HTTP→原生日志→助手chain断言通过；真实模型另4项断言核对native日志、独立版本及实际实现，dirty状态未猜根因。隔离验证初次缺Redis、请求ID误以为客户端可指定及model脚本env/重复close清理问题均已修正；只清理了本轮临时容器。
- `/tmp/support-native-local-check.ts` 当前本机Web API→当前worker→真实Canvas JSONL/gateway Docker日志→模型答复闭环通过，不仅是手工构造日志或隔离数据库。用户看到的证据含同一实际requestId、双方404、服务版本及源码，未将开发构建签认为线上根因。
- 边界：日志采集前的历史不可补回；info级别缺少成功GET等低级别日志。其他未部署/未配置服务仍显示真实缺口，原分镜异常根因未在本轮确认。未push、未部署生产。

## 本地适配、环境隔离与上线配置准备（2026-11-03）
- 范围：先让现有 FG / Production Lab / Yingce Web / gateway / Canvas / 独立 Agent 在本机可核验，准备生产配置；不操作生产、不自动提交。五个其他原生产品仍是明确缺口，不能将 gateway 回执冒充其原生数据。
- 隔离：新增强制 `SUPPORT_BOT_ENVIRONMENT`，本地业务数据库及版本地址限制 loopback、外发关闭；数据库须有同环境数据库级 `fg.support_environment` 标记，拒绝连接参数覆盖目标/标记。主库读写入口、辅助只读事务、独立版本和结构化日志均检查环境，缺失/不符 fail closed。数据库只读来源改用专用 SELECT 角色，不只依赖 URL 的 readonly options。
- 原生事件增加真实 `build_environment`；本地 Docker 日志只允许 Unix socket，读取改为有界流式保留尾部，修复大量历史日志超过2MiB时整个来源不可读。旧无环境事件不签认、不补造历史。
- 本机：新建隔离 Production Lab 库，按真实001–006迁移和空状态初始化；应用与助手使用不同权限角色。Canvas/gateway 使用已确认本机库，Canvas 改接 loopback 独立 Agent，Agent 使用真实 Pi runtime/锁定依赖；Vite、Next 与 worker 已启动，飞书外发关闭。仅重载了已核实且空闲的本地服务。
- 配置预检：`pnpm support-bot:preflight --require=fg,production-lab,canvas,yingce-gateway,yingce-web,yingce-agent` 通过；无 `--require` 时全部真实产品都为 required，五个缺口导致退出1，未伪报全覆盖。该检查只证明配置/源可读，不替代真实故障或生产验收。
- 验证：主站 `pnpm exec tsc --noEmit --incremental false`；AI/脱敏现有12项测试；Go logging/buildinfo/yingceagent 测试；`/tmp/support-environment-check.ts`（21项环境/权限边界，含显式READ WRITE仍被ACL拒绝）；`/tmp/support-environment-api-check.ts`（GET/POST错环境503、队列不变）；`/tmp/support-native-e2e.ts`（41项隔离HTTP/账号/链路断言）；`/tmp/support-local-sources-check.ts`（实际本机HTTP、原生事件、4个独立版本与空Production Lab库）；`/tmp/support-native-local-check.ts`（实际Web API→worker→模型→日志/版本/源码证据→答复）通过。Agent为真实运行时的故意无效输入负例，不是已定位用户业务故障。
- Production Lab实际API返回200；Canvas管理员性能接口当前用户返回403，未绕过权限验证其面板。独立Agent接线由本地进程配置及服务直接检查核验，未声称完整真实模型业务流已经全部验收。
- 上线清单与隔离顺序写入现有README、`.env.example`/`.env.docker.example`；没有填生产密钥、没有访问/部署生产。ArcReel/OpenCreator/AdCraft/Meilin/Suno仍需原生合约、可信账号/实例映射与服务各自的只读适配，不是填URL即可完成。

## 全产品原生接入补齐（2026-11-03，本地验收完成，发布待审批）
目标是可准备部署，不是直接部署。FG、Yingce Web/Gateway/Canvas/Agent 及 ArcReel、OpenCreator、AdCraft、Meilin、Suno 全部逐项验收；旧 Production Lab 与生产实际路由明确区分。

- [x] 五个产品真实持久化业务记录的受控只读接口，使用真实账号/实例/workspace 归属；不接受用户自报身份或任意 URL。
- [x] 原生请求日志与运行版本随真实服务生成；production/clean/commit 对应是程序签认门槛，开发态明确仅作参考；缺数据不伪造。生产新构建的实际签认仍是部署后验收项，不算本地完成项。
- [x] 助手 tools、预检及部署配置覆盖新接口；不能靠缩小 --require 掩盖缺口。
- [x] 隔离本地真实服务逐项验证：操作→持久化→请求日志→运行版本→助手证据；覆盖跨用户拒绝、错误请求、文本与截图、取消及无证据兜底。
- [x] 复核安全边界和资源上限；更新既有部署文档、迁移/只读授权/worker/采集/回退命令，明确上线前人工确认点。

执行分工：各产品原生接口与观测独立实施，主进程负责共享取证合同、可信路由、预检、整体验收。使用已有依赖与测试，不自动 commit/push；不操作生产、不构建生产镜像、不停任何生产守护进程。所有未真实验证项目保留未完成状态。

### 本轮共享链路初始进展（后续全量验收见末节）
- 新增 `product-native` 受控只读客户端并接入工具、运行版本和全量预检：先查同环境 active 账号映射，唯一受信 Gateway origin + 独立 token，流量/时间/条数有界，缺口不回退别的服务。
- OpenCreator daemon/Web、AdCraft API/Agent/Web 要分别核验版本；一个组件不能代表全产品。native 日志保留事件 commit/dirty，并沿用根因确认门槛。
- 跨服务调查不再自动套用反馈页面的 Canvas projectId；不支持的 session 筛选 fail-closed。
- 复跑现有 AI/脱敏 tests：12/12；`/tmp/support-environment-check.ts`：21项隔离回归；`support-bot:worker --check`：通过。未生成仓库测试文件。
- 初次新全量 preflight：核心六项可查询，五产品缺试点账号/relay配置，退出1（预期且不隐藏）；后续须接入真实本地进程再次核验，不能拿这个结果称全量完成。
- 仅生成 `/tmp/fg-support-native-integration/` 中0700目录/0600本地随机只读token，未改生产配置或复制生产密钥。既有开发模型供应商配置仍与业务数据源隔离。

### 已完成的共享链路与真实交互核验（2026-11-03，本轮继续）
- `product-native` 白名单投影、严格 actor/time/filter echo、坏行传导 incomplete、环境隔离与独立组件版本校验落地。错误码仅作观察/检索线索，不单凭同名文本或注释确认根因；原生日志签认拒绝空/过短/非法 commit。定向复核：report 20 组、native 投影 33 组边界通过（内存 fixtures，不冒充 E2E）。
- 真实本地 AdCraft 页面截图，经网页上传→现有 high 模型 worker→全仓实际源码读取，识别 AdCraft 首页并定位 `HomeShowcase.tsx`/`HomePage.tsx` 创建入口；26次可见状态变化、SSE重连、完整结果剪贴板逐字一致。真实运行中发送被409拒绝，终止后 worker 中止模型并保留 cancelled；未 mock API/clipboard。首次 UI 断言误检查 disabled 而非实际 readOnly，已修正验证脚本并通过真实控制回归，没有为测试更改 UI 行为。
- 真实 Suno 本地关闭供应商的503请求，经网页API→worker→模型读取同任务/请求/毫秒时间窗的 operation、原生日志及 `SUNO_NOT_CONFIGURED` 实际实现，核对自身版本后 SSE 返回事实与缺口。开发 dirty 版本不签认生产根因；未收费生成。
- 实际联调发现并修复所有服务 chain 展开丢弃已报告时间窗的问题；Gateway/Suno 真实查询分支保留原窗口。报告不再把窄窗口无可验证日志误称为该服务从未接入，源码分页也不再称请求链截断。
- 本地核心源复跑：真实 Canvas/Gateway 404、Agent 原生运行负例、四个版本接口、跨用户拒绝、旧 Production Lab 空独立库通过。现有 AI/脱敏12项、环境边界21项通过。五产品仍以最终整合矩阵为准，不以此替代。
- 临时、私密本地证据集中 `/tmp/fg-support-native-integration/`；真实验证脚本 `/tmp/support-products-ui-controls.mjs`、`/tmp/support-native-text-e2e.ts`、`/tmp/support-native-shared-live.ts`、`/tmp/support-native-scope-regression.ts`。这些不是持久仓库测试套件。

### 生产只读核验（2026-11-03 17:29–17:31，Asia/Shanghai）
- 仅 SSH alias `server` 读取容器/版本、退役路由及两库 catalog；无构建、迁移、配置写入、启停、push 或部署。
- 主站实际 `/api/version` 仍为 `deploy-20261103T055055Z-baadc2fd5e4f`。不能把本地5806及本轮未提交代码称为生产运行版本。
- 生产 ArcReel、OpenCreator 用户入口均实际返回410；当前仅保留 creator shared Web 容器，不代表 daemon/业务入口在用。本轮不解除退役保护、不重建实例。
- 生产 FG 库 `fg_studio` 尚无助手表/列；FG 与 Canvas 库 `fg_yingce` 的数据库级环境标记均未设置。Canvas 的 `fg_support_readonly` 角色存在；此存在性检查不代替之前SELECT权限验收。
- 未发现 `scripts/support-bot-worker.ts/js` 进程，所查相关容器均未注入新原生只读token。生产私密草稿未应用，不能宣称生产接通或闭环已通过。
- 部署门槛仍是：用户批准窗口→核对/备份→016–020及产品幂等schema→环境标记/授权→批准的构建与实际元数据→只读token/loopback overlay/宿主worker→生产preflight与真实试点闭环。只有准备材料可审阅，不提前执行以上变更。


### 最终整合验收（2026-11-03，本地）

- `node --env-file=/tmp/fg-support-native-integration/worker.env --import ./node_modules/tsx/dist/loader.mjs /tmp/support-native-shared-live.ts arcreel opencreator adcraft meilin suno` 全部通过：使用真实进程和持久化存储，读取严格 scoped 原生证据、独立版本、链路和跨账号拒绝；不使用 mock 代理/伪日志。
- `SUPPORT_BOT_NATIVE_PROBE_FROM=2026-11-03T09:32:00.000Z SUPPORT_BOT_NATIVE_PROBE_TO=2026-11-03T09:37:59.834Z node --env-file=/tmp/fg-support-native-integration/worker.env --import ./node_modules/tsx/dist/loader.mjs scripts/support-bot-preflight.ts`：默认全11项 required/ready，无 `--require`。五产品在共同窗口内均有真实已鉴权业务 HTTP 日志；不把探针/health 充当日志，不宣称窗口之前历史完整。

| 真实本地原生证据 | 操作条数 | HTTP日志条数 | 独立组件与边界 |
| --- | ---: | ---: | --- |
| ArcReel | 1 | 1 | Python实例；request/trace只关联日志，操作源明确partial；入口退役未恢复 |
| OpenCreator | 2 | 3 | daemon + Web；日志跨重启持久化；trace不支持；入口退役未恢复 |
| AdCraft | 2 | 1 | API + Agent + Web，受信workspace归属 |
| Meilin | 1 | 1 | FG集成服务、PG记录与持久日志 |
| Suno | 1 | 1 | adapter自身版本、状态文件和原生503，不是供应商生成验收 |

- 其余六项：FG与旧 Production Lab 的数据库/环境结构，Canvas/Gateway/Agent 的实际原生日志与版本，Web自身构建元数据；Web无服务端业务库/日志，旧 Production Lab 为隔离空库，均不冒充非空业务闭环。
- 最终主站 `pnpm exec tsc --noEmit --incremental false` 与 `git diff --check` 通过。真实日志/数据/版本测试的安全凭据只在私密 `/tmp` 目录，未写仓库；临时证据不作为长期测试套件。
- 现存生产仅做只读核验；本轮不 commit/push、不构建部署生产、不应用overlay、不修改生产配置/数据库、不停止生产守护进程。达到的是**代码与隔离本地验证可进入发布审批**，不是生产已接通。发布仍须先取得用户批准，再按 README 的备份/迁移/环境标记/原生接口与版本部署/worker/预检/真实试点顺序执行。

- 最终代码加载后，确认本地无 pending/processing 工单，仅重载已核实 cwd/PID 的自建本地 worker，`--check`通过，飞书发送保持关闭。`/tmp/support-native-text-e2e.ts`再次通过：工单`1b815570-221d-47cd-b0ac-2bec5654ac31`、21个SSE状态快照，实际消费 Suno 503/SUNO_NOT_CONFIGURED、精确 task/request/时间窗和源码；开发dirty版本仍明确未确认根因，不把预期的证据门槛降级为猜测。
- 最后复跑 AI/脱敏既有12项全部通过；测试日志有一次异步 observability 持久化连接超时提示，不影响断言结果，不能据此声称该测试进程的日志落库成功。真实本地worker持久化与网页读取由上述E2E单独验证。
- 补做第二个**真实 active owner** 的隔离验收，不仅是未映射随机账号：`node /tmp/fg-support-active-owner-isolation/verify.mjs`，42个真实relay请求通过；AdCraft/Meilin/Suno在B账号与独立workspace下查询A的实际编号及伪造A headers均无泄漏，Arc/OC因B无实例明确503且不fallback。只清理本次创建的B四条映射/账号/项目记录，残留0、A未改变；Meilin无task fixture，该单项不称已验证。证据 `/tmp/fg-support-active-owner-isolation/run-18m5qU/report.json`。
- 结束子代理后发现其终端托管的本地AdCraft三进程退出；已由主进程使用原启动脚本detached接管并保留原fixtures。启动完成前的A正向控制503如实记失败，确认监听和版本可读后才重跑隔离验收；最终42请求及默认全11预检重新通过。没有停止/改动生产进程。
