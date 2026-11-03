# 网页自助排查：以证据为依据的调查

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
