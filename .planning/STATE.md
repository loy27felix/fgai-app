# 当前状态

- 日期：2026-11-12（Asia/Shanghai）。
- 当前目标：根据问题联合全仓安全源码、本人日志及实际请求/响应参数定位原因与解决办法；包含而不限于 production-lab/meilin（原 production-lab/yingce），不恢复废弃主站业务取证，不改生成执行。
- 当前计划：`.planning/phases/support-investigation/PLAN.md`。
- 当前状态：通俗回答、历史问题异步参考及线上美林目录迁移适配已提交/push（运行代码 `b983581f`，独立分支 `codex/support-plain-language-history-20261111`），并在用户本次明确授权后于 2026-11-12 09:41（Asia/Shanghai）完成独立助手切换。实际 release `support-20261112T013950Z-b983581f`、PID 43094、启动版本与源码一致；主业务容器和其他守护任务未变。未推送 main 或触发主业务自动发布，既有数据覆盖缺口和真实模型效果验收仍未关闭。

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
- 范围纠正：用户是在确认是否包含 Yingce，不是要求排他性收窄。撤销仅四项/仅 production-lab/yingce 目录的限制，恢复其他产品、基础设施和源码定位；分类与默认值不将其他问题强制归为 Yingce。仍遵守不查询废弃主站及旧 Production Lab 主站模块，保留身份/工单存储。
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
- 边界：本轮未 commit/push、部署、真实模型调用或新增仓库测试文件。前轮人工反馈未提交改动完整保留；生产发布仍需单独授权，并准备对应运行提交的源码、先执行反馈 021 增量迁移。
