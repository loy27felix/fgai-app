# FG 画布上游差异与适配清单

核对日期：2026-10-25。以下为实施前的差异快照；随后已按用户要求完成 FG 1.4.19 适配，实施说明见 [1.4.19 功能适配](../../production-lab/yingce/canvas/docs/releases/1.4.19-upstream-parity.md)。历史对比数字保留，不代表实施后的功能缺口。

## 对比范围与结论

- 上游：`ddcat-ai/open-ai-canvas`，本次重新拉取的 main 为 `cd694236f82e2851393cadc0150ebbde375cdc81`，提交日期 2026-10-23，版本 `v1.6.9.2`。
- FG：`c9628c481cb940f58cb44e5556ff15e8270eb2cd`，产品版本 `1.4.18`；被审阅目录为 `production-lab/yingce/canvas`。
- 近期范围：上游 `f368e6309`（v1.6.8.3）之后至 `cd694236f`，覆盖 10 月 15—23 日，主线共 116 条提交。另追溯 FG 1.3.25、1.3.26、1.4.7、1.4.13、1.4.14 的选择性同步记录。
- 对此范围内发生变化、且在上游末端仍存在的 `web/src`、`backend/internal`、`backend/agent-runtime` 等源文件逐项比较：597 个路径中，320 个与上游一致，220 个有 FG 差异，57 个不存在于 FG。该数字包含测试；**57 个文件不等于 57 项功能缺失，220 个差异也不等于未同步**。
- 对近期变更的协议 manifest 另做结构化比较，确认 Responses 和可美 Seedream 存在实际未接入项。

结论：FG 已选择性吸收大部分近期画布交互与稳定性改动，但不是上游整包镜像。目前有跨设备对话、反馈系统等功能缺口，也有协议参数、素材多选等较小但应补齐的差异。不能用“已到 v1.6.9.2”代替功能核对。

Git 拉取结果是本次版本判断依据；网页抓取的 commits 页面返回了旧缓存，没有用该缓存推断最新版本。

## 尚未完整接入的内容

优先级含义：P0 优先处理一致性；P1 下一批主要能力；P2 可选或低影响。以下是代码差异审计，不代表每项都已在生产触发故障。

| 项目 | FG 现状与用户影响 | 建议适配 | 优先级 |
| --- | --- | --- | --- |
| 跨设备画布 Agent 对话 | 缺少服务端会话目录、分页轮次 API 及前端云历史拼接。当前会话列表/展示消息主要保存在本浏览器的账号隔离缓存；后台任务持久化不等于换电脑能还原完整聊天列表。 | 接入服务端目录与轮次分页，按会话/轮次/事件 ID 合并；保留附件、多问题选择、未发送草稿和原请求幂等身份。 | P1 |
| 多端续聊与同画布 Agent 并发准入 | 未接上游 `requireCurrentCloudAgentParent`、`requireExclusiveCanvasAgent` 的事务准入链路；已有任务额度、任务执行租约和幂等机制不能等同于这两种保护。 | 先补同一会话的旧轮次检查、同一画布的运行占用，再接跨设备继续对话；重复原请求返回原运行，冲突不能新建收费任务。 | P0，作为跨设备能力的前置 |
| 文本编辑占用提示/租约 | 未接上游字段编辑租约。FG 已有多人光标、文本合并、版本冲突恢复，并非没有多人协作。 | 保留多人同时编辑；先增加“谁正在编辑”提示。若加租约，限定到正在聚焦的字段，具备过期释放和断网恢复，不整张画布锁死。 | P2 |
| 用户反馈插件 | 缺少反馈表、API、提交窗口、个人收件箱、管理员处理页；插件策略中出现名称常量不等于完整功能已接入。 | FG 工作区提供统一反馈入口，可附截图/短视频、页面与请求编号；用户查看回复，管理员分类、回复、处理和归档。 | P1 |
| 素材库 Shift 连选及完整跨页批量操作 | FG 有多选，但无上游 `selectAssetIds` 区间选择；导出/删除仍从本地 `selectedAssets` 推导对象，上游已改成按完整 ID 集合加载并执行。远端分页、缓存不完整时有漏项风险，尚未作浏览器复现。 | 选中集合以 ID 为准，Shift 范围限定当前可见顺序；执行前补齐选中项，显示实际数量，处理中防止重复操作。保留 FG 的章节/画布分类。 | P0 |
| OpenAI Responses 普通图文请求映射 | 仓库插件为 `2.0.0`，上游 `2.0.1` 增加 `text → input_text`、`image_url → input_image` 内容块转换。普通 Chat Completions、个人 Trings 专用线路不能据此判为有同一问题。 | 更新独立 Responses 协议包及安装版本；单独验证纯文本、图文、system 指令与 Agent 工具调用，保留原渠道和费用路由。 | P0，对使用 Responses 的渠道 |
| 可美 Seedream 5.0 参数声明与 1.5K 档位 | FG 插件缺上游新增的 `imageParameters`；通用图片价格档位代码仍只列 1K/2K/4K，没有对应 1.5K 精确尺寸归类。不能泛化为所有 Seedream 渠道都缺参数，也未据此认定已发生错扣费。 | 同步该协议的 1K/1.5K/2K、单张数量、禁用透明背景声明；补精确尺寸识别，按 FG 现有价格配置核对报价与结算。不要把其他模型强行改成相同档位。 | P0，对对应协议 |
| SDK 层工具参数校验失败回执 | 上游 runtime 的 `tool_validation_failed` 事件、Go 接收分支和持久回执 helper 在 FG 均未接入。FG 已有其他参数纠偏，不能据此说完全没有纠错。 | 核对 FG runtime 校验路径，补失败调用的结构化回执与调用游标推进；明确“本次没有执行”，防止运行时与服务端状态不同步。 | P1 |
| 后台服务商推荐目录与一键接入 | 未接远程推荐服务商、Key 核验、推荐模型和加价导入向导。已有协议插件目录是另一种能力。 | 如有运营需求，再做 FG 自己可控的管理员目录；只预览、核验和按选择导入，不自动替换现有公司渠道、成本或售价。 | P2 |
| 模型 Logo 大小写兼容 | 上游增加品牌 ID 归一解析，FG 仍按原 ID 精确查找，大小写不同可能回退为通用图标。 | 独立移植解析 helper，不改写用户保存的渠道数据。 | P2 |
| 短剧入口开关的一处遗漏 | 侧栏已判断 `shortDramaEnabled`，命令面板仍无条件加入短剧入口；上游最新修复已同时过滤。 | 统一导航可见性判断，保留后端权限检查；这不是已确认的越权漏洞。 | P2 |
| 用户错误中的地址脱敏 | FG 已过滤敏感错误和 URL，也有诊断脱敏；未接上游统一 `redactUpstreamAddress`，其对 IP/TCP 地址及任务/账务可见文本的覆盖不同。未检查生产返回内容，不能认定实际泄漏。 | 对用户可见的任务错误、退款原因、账本备注做专项核对；复用统一脱敏出口，管理员诊断保留受权限控制的排障信息。 | P1，先核对出口 |

## 代码依据

下列路径以 `production-lab/yingce/canvas/` 为 FG 相对根；“缺少”表示查验过路径及调用入口，不仅按提交标题判断。

| 项目 | 上游来源 | FG 对照位置 |
| --- | --- | --- |
| 云会话、跟随运行、模型恢复 | [018acdfca](https://github.com/ddcat-ai/open-ai-canvas/commit/018acdfca)；`app/cloud_agent_conversations.go`、`repository/cloud_agent_conversations.go`、`cloud-agent-history.ts`、`cloud-agent-follow.ts`、`cloud-agent-model-restore.ts` | `web/src/services/cloud-agent-conversations.ts` 的 `saveCloudAgentConversations` 写账号隔离 localforage；`backend/internal/handler/agent.go` 无新增的两个 conversation GET 路由 |
| 运行准入与编辑租约 | [76f61928b](https://github.com/ddcat-ai/open-ai-canvas/commit/76f61928b)、[018acdfca](https://github.com/ddcat-ai/open-ai-canvas/commit/018acdfca)；`repository/cloud_agent_canvas.go`、`canvas/edit_leases.go` | `backend/internal/repository/finance.go` 的两种任务创建事务未调用上述准入检查；相关租约文件缺少 |
| 反馈系统 | [f1d1f9738](https://github.com/ddcat-ai/open-ai-canvas/commit/f1d1f9738)、[389bd2bca](https://github.com/ddcat-ai/open-ai-canvas/commit/389bd2bca)、[bfff29f80](https://github.com/ddcat-ai/open-ai-canvas/commit/bfff29f80) | `feedback.go`、`models_feedback.go`、`feedback_routes.go`、三个反馈前端入口和 API 均缺少 |
| 素材选择 | [4a7d569f3](https://github.com/ddcat-ai/open-ai-canvas/commit/4a7d569f3) | `web/src/pages/assets/index.tsx`，`selectedAssets`、`exportSelectedAssets`、`confirmBatchDelete`；无 `asset-library-selection.ts` |
| Responses 映射 | [86ebb6c53](https://github.com/ddcat-ai/open-ai-canvas/commit/86ebb6c53) | `plugin-packages/openai-responses/manifest.json`，版本与 `create.body.input` 结构不同 |
| Seedream 声明、1.5K | [bf2dc196f](https://github.com/ddcat-ai/open-ai-canvas/commit/bf2dc196f) | `plugin-packages/km-kemei-seedream/manifest.json` 缺 `imageParameters`；`backend/internal/app/model_router.go` 无 `seedream15kSizes`，档位枚举无 1.5K |
| SDK 参数失败回执 | [e30cb3405](https://github.com/ddcat-ai/open-ai-canvas/commit/e30cb3405) | `backend/agent-runtime/pi/agent-runtime.mjs` 和 `backend/internal/app/cloud_agent_pi_bridge.go` 无该事件；无 `cloud_agent_pi_tool_rejections.go` |
| 服务商目录、Logo | [6423c011b](https://github.com/ddcat-ai/open-ai-canvas/commit/6423c011b) | 缺 `providercatalog`、`provider-catalog-wizard.tsx`、`api/provider-catalog.ts`、`model-logo-id.ts`；`model-logo.tsx` 仍精确查找 |
| 入口开关 | [19eec9bc4](https://github.com/ddcat-ai/open-ai-canvas/commit/19eec9bc4) | `web/src/components/layout/workspace-command-palette.tsx` 与 `workspace-sidebar-nav.tsx` 行为不一致 |
| 脱敏 | [4796bd535](https://github.com/ddcat-ai/open-ai-canvas/commit/4796bd535) | `backend/internal/app/provider_error_message.go`、`diagnostics.go` 已有 FG 实现；无上游统一 helper |

## 已接入或已有 FG 等价能力

这些不应再列入“咱们没有”。“代码已接入”不等于每个真实供应商场景都已验收。

| 能力 | 当前结论 / 依据 |
| --- | --- |
| 平台级单一 Agent 面板、按页面绑定画布 | FG 1.4.13 已接；本浏览器的旧画布对话迁移为账号级历史。与上表的跨设备云会话是两件事。 |
| 多窗口实时光标、文本合并、保存冲突恢复 | FG 1.3.26 已接并适配同事身份与共享项目；未引入排他编辑租约，不应把整个协作功能判缺失。 |
| 画布连线反馈、目标命中、拖线预览 | FG 1.4.14 已接；保留减少动态效果偏好。 |
| 网格、Dock、节点比例动效、浮层位置、自动整理 | FG 1.4.13 已接，整理绕开固定节点。 |
| 音频真实波形、播放游标 | `canvas-audio-waveform.ts` 用 Web Audio 解码，`canvas-audio-player.tsx` 用动画帧更新游标；1.4.18 已接。 |
| 视频时长补齐、增强源时长、签名续期播放器稳定 | 对应最近几轮同步已接；不等于放宽供应商参考视频时长限制。 |
| 项目资产关联中断恢复 | `project-asset-sync.ts` 持久队列和 `subscribeRemoteUserDataReady` 恢复入口已接。 |
| Agent 批量看图、审批尺寸与结果回执、0 上限不限 | 1.4.18 已选择性接入；`cloud_agent_vision.go` 使用 `nodeIds/purpose`。权限、费用和确认流程继续生效。 |
| 个人模型标签、渠道名、张数选择、思考按钮与 Tooltip | 1.4.18 已接主要 UI 修复；Logo ID 大小写兼容另列为缺口。 |
| 中文安全拒绝分类、放大编辑引用菜单 | 1.4.18 已接；不会因此绕过模型审核。 |
| 素材批量上传拖放、真实进度和失败原因 | FG 1.4.13/1.4.14 已接；桌面拖入画布另有 FG 捕获阶段处理。真实系统拖放仍以用户电脑验收为准。 |
| 批量表、图片工具、外观预设、ZIP 动画形象 | FG 1.4.7 已接，保留 FG 原有背景和形象回退。 |
| 预演摆场/动画模式、牵手/受击等动作 | FG 1.4.13 已接。 |
| 场景/道具独立出图、图片绑定、历史版本 | FG 有自己的资产卡和生成流程，例如 `pages/projects/detail/assets.tsx` 的“本资产历史版本”；不照搬第二套入口。 |
| Cheaper Inference、MaxForAI、百炼 MiniMax、火山 MediaKit 协议包 | 本次比较的 manifest 与上游一致；包存在不代表线上已配置对应渠道、凭据和价格，不自动创建渠道。 |

## 建议的适配顺序

### 第一批：补小范围一致性

1. 素材库以 ID 为准的跨页操作与 Shift 连选。
2. Responses 2.0.1 图文映射、可美 Seedream 参数与 1.5K 档位，逐协议适配；报价按 FG 当前账务合同，不直接照搬上游积分回退规则。
3. SDK 校验失败回执；顺带补模型 Logo 解析和命令面板入口开关。
4. 核对用户可见错误脱敏出口，已有等价路径保留。

验证：分页选中/导出/删除对象一致；缺缓存项、重复点击和失败保留选择；协议请求体快照、纯文本/图文/工具调用；1.5K 及各档位报价；校验失败无写入、无新收费任务。先用模拟供应商和隔离数据库，避免自动重跑用户收费生成。

### 第二批：完整跨设备对话

不能只换聊天窗口。按以下依赖完成一条完整链路：

1. 持久会话身份、服务端目录、分页轮次与事件恢复；只查询当前授权用户/画布范围。
2. 在任务创建事务中加入当前父轮次检查与画布 Agent 并发准入，保留 FG 逻辑模型检查、额度预留和原请求幂等规则。
3. UI 合并远端历史与本地草稿，不以旧设备快照覆盖新消息；附件、选择题、未完成审批继续恢复。
4. 另一设备有活动对话时提示查看/继续，不擅自覆盖当前输入。恢复模型时同时校验渠道身份；无法唯一确定时请用户选，不能切换到默认收费线路。
5. 历史迁移可重复执行、以 ID 去重，保留旧缓存。上游只提供画布范围的会话目录，FG 的全局未绑定对话还需定义相应目录入口，不能声称换电脑一定找到所有全局聊天。

验证：双设备同时发下一轮、旧页面续发、相同幂等键重试、SSE 断线与分页接续、账号切换、共享项目权限、切画布时草稿保护、原审批与付费任务不重提。上次部分接入尝试暴露了准入依赖未配齐的问题；应补完整依赖后验证，不把该局部失败解读为上游功能普遍不可用。

### 第三批：反馈闭环

新增 FG 自己的反馈入口与管理员处理页，复用现有登录、附件资源和权限体系。数据库迁移采用 FG 独立编号，不覆盖当前迁移记录。附件关联到反馈归属；自动环境信息需脱敏，不收集 Key、Cookie 或完整剧本。先提供提交、回复、状态和归档，后续再考虑与请求日志关联。

### 后续可选

- 编辑占用提示先做轻提示；字段租约应单独验证共享画布所有者/成员模型，不照搬成互相踢人的全画布锁。
- 服务商目录由 FG 运营控制；推荐项与真实模型权限、成本、售价分开，启用前预览。
- 不直接同步上游版本号、部署流水线、供应商推荐数据、默认 Skill 或整套积分政策。它们属于产品边界差异，不是画布功能落后。

## 本次验证边界

本次完成 Git 对象、源文件、调用入口、协议 manifest 及历史同步记录核对，未运行应用测试、未进行双设备浏览器验收、未读取用户项目或生产会话、未改变线上版本。上述“需补齐”是后续实施清单，不是已上线公告。

历史依据：[FG 1.3.25 同步记录](1.3.25-upstream-sync.md)、[FG 1.3.26 同步记录](1.3.26-upstream-sync.md)、[FG 1.4.7 同步记录](../../production-lab/yingce/canvas/docs/releases/1.4.7-upstream-sync.md)、[FG 1.4.13 同步记录](../../production-lab/yingce/canvas/docs/releases/1.4.13-upstream-sync.md)、[FG 1.4.14 同步记录](../../production-lab/yingce/canvas/docs/releases/1.4.14-upstream-sync.md)、[FG 1.4.18 待验收说明](../../production-lab/yingce/canvas/docs/content/docs/progress/pending-test.mdx)。
