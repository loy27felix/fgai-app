# 美林接入 FG Studio：交接说明（给 Codex）

写于 2026-10-15。读者：负责把美林并进 FG Studio 的工程师（Codex）。目标：美林成为第六板块（FG超级工作台）里的一个正式入口，文本、出图、出片全部走公司真实模型，费用进 FG 人民币报价、预算和账单。

## 1. 现在的美林在哪里、是什么

| 项 | 现状 |
| --- | --- |
| 代码 | `D:\FG.AI\fg-director-agent`，只有本地 git（最新提交见 `git log`），没有远端，**不要推送这个仓库** |
| 运行 | `node server/index.mjs`，端口 5310，零依赖 Node 服务；前端 Vite + React，`npm run build` 输出到 `web/dist`，由同一个服务托管 |
| 模式 | 默认模拟：剧本、提示词为预置内容，出图出片是模拟任务，不扣费。填了 `WETOKEN_API_KEY` 后文本走真实模型，出图出片仍是模拟 |
| 数据 | `data/dramas/<id>.json` 一部剧一个文件；上传图片在 `data/uploads/` |
| 和 FG 的关系 | 还**没有**接入 FG Studio。模型 id、画风库、能力表是从 FG 抄过来的镜像（`server/models.mjs`、`server/fg/*`） |
| 业务说明 | `docs/DESIGN.md`（流程、记忆、分段规则、声音规则、技能清单）；`README.md`（运行方式） |

## 2. 先读这些（FG Studio 以 origin/main 为准）

本机 `D:\FG.AI\fg-studio` 的 main 落后 origin/main 两百多个提交，请在最新的 origin/main 上建分支再动手。

FG 已有两个"外部应用并入第六板块"的先例，美林照着做，不要另起一套：

- `production-lab/adcraft/INTEGRATION-DESIGN.md`：广告工作台的接入设计（身份与权限、WeToken 桥接、保存与素材、人民币成本四座桥）。
- `production-lab/arcreel/FG-USAGE.md`：导演工作台（独立容器 + FG 网关）的用法。
- 身份：`lib/production-lab/access.ts` 的 `labActor()`。
- 媒体任务与报价：`app/api/production-lab/media/{models,estimate,jobs}/route.ts`，`lib/production-lab/media-runner.ts`（`submitLabMediaJob`、`refreshLabVideoJob`）、`media-accounting.ts`。
- 文本记账：`app/api/production-lab/agent/route.ts`、`lib/production-lab/agent-accounting.ts`、`lib/production-lab/text-models.ts`。
- 价格、预算、账本：`lib/usage/pricing.ts`（`estimateImagePrice`、`estimateVideoPrice`、`estimateTextPrice`）、`lib/usage/budget.ts`（`assertMonthlyBudgetAvailable`）、`lib/usage/ledger.ts`（`recordUsageRequired` 等）。
- 左侧入口：`production-lab/meilin/canvas/web/src/components/layout/workspace-sidebar-nav.tsx`（"短剧 Agent""广告工作台"在这里）。

## 3. 建议的接入方式

照 AdCraft / ArcReel 的模式：美林保留为独立服务，由 FG 网关代理，不在 Next 里重写。

1. 把美林源码放进 FG 仓库 `production-lab/meilin/`（上游源码 + `deploy/` 适配层），与 `adcraft/`、`arcreel/` 同级。
2. 第六板块左侧加一个入口「美林 · 超级导演」，和"短剧 Agent""广告工作台"平级。**是否替换现有"短剧 Agent"由我决定，先并存。**
3. 美林服务只监听本机，不对局域网开放端口；浏览器只和 FG 网关说话，网关验证登录后把可信的 FG 用户 ID 带给美林。美林不能接受客户端自己报的用户 ID。
4. 前端用独立 base 路径（例如 `/meilin-app/`），API 和媒体路径都加前缀，不占用 FG 的 `/api` 根。

## 4. 要换掉的接口（只换这几处，业务逻辑不动）

| 美林里的位置 | 现在 | 接入后 |
| --- | --- | --- |
| `server/llm.mjs` → `chat()` | 直连 WeToken `/chat/completions` | 走 FG 服务端文本通道，用户、小组、项目快照记账（参照 agent-accounting，ledger source 新建一个美林专用值）；调用前做预算检查 |
| `server/models.mjs` → `MODELS` | 抄的静态列表 | 从 FG 模型目录（media/models + labTextModels）读取，只显示管理员已开启的模型和参数；保留现有 `segmentRange`、`maxRefs`、`planSeconds` 规则 |
| `server/brain.mjs` → `assets.render`，`server/index.mjs` → `runPending()`，`server/media.mjs` → `generateImage()` | 模拟出图；`MEILIN_REAL_MEDIA=1` 时只有 GPT Image 真出 | 先报价，用户确认后提交 FG 图片任务；记录 FG 任务 ID，按 ID 轮询；结果存到 FG 存储，再写回资产版本的 `url` |
| `server/brain.mjs` → `shoot.submit`、`refreshJobs()` | 模拟视频任务（定时器） | 每段提交一个 FG 视频任务：时长 = 该段 `seconds`，比例 = `settings.aspect`，参考图 = 该段 `refs` 对应的资产图（不超过模型的 `maxRefs`），提示词 = 该段 `prompt`；记录 FG 任务 ID，断线后按 ID 恢复，**绝不重新提交导致重复扣费** |
| `data/dramas/*.json`、`data/uploads/` | 本机文件 | 每部剧归属一个 FG 用户（可显式分享给同事），读写都校验权限；媒体存到 NAS 的美林目录，数据库或 JSON 放持久卷并备份 |

模拟模式保留为开发用，界面上必须清楚标出"模拟"，不能把模拟结果说成真实生成。

## 5. 花费要怎么呈现

全部复用 FG 的报价和账单，不在美林里维护第二套价格或汇率。前台只显示人民币。

- **出图前**：单张显示报价；"全部出图"显示合计和本月剩余额度，确认后才提交。
- **出片前**：拍摄页按段显示报价（模型、分辨率、秒数、参考图张数），批量提交显示合计和剩余额度，确认后才提交。预算不足时说清楚差多少、谁能调整。
- **文本**：美林每轮对话、写剧本、写分段的文本费用也要记账，不能漏。
- **费用页**：在美林左侧"全剧"下加一个「费用」页，按剧 / 按集 / 按段 / 按资产汇总，区分 预估、服务商回报、已核销；待核销不显示成 0。
- **报价不可用**：模型没有价格或参数不支持时，说出具体原因，不显示假的 0 元。

## 6. 必须保留的业务规则

这些是成员已经确认过的，接入时不要改：

- 流程：立项 → 圣经与画风 → 每集 剧本 → 本集资产 → 分段提示词 → 拍摄 → 后期；全剧资产库跨集复用；每部剧有自己的长期记忆。
- 剧集：全剧集数随时可改，可以加一集、在任意一集后插入一集、删掉一集（后面的集自动补位，记忆里的集数同步改）。
- 分段：每段时长按剧情定，10–25 秒，且不超过出片模型上限（≤15 秒的模型就是 10–15 秒）。
- 参考图：每段自动挂出场人物 + 场景 + 道具，成员可以增删和调顺序；提示词【参考图绑定】只用 @代号。
- 提示词格式：FG 视频提示词格式（【视频整体概念】…【负面约束】+ 衔接锁），分段导演默认"剧本转文戏"。
- 声音：视频只随片生成音效、对白和旁白；**不生成 BGM，不生成字幕**（后期加）。这是每部剧自带的制片规则。
- 技能：从技能目录原地读取，不复制进仓库。

## 7. 硬性约束

- 没有我明确授权，不发起任何付费的出图、出片或付费验收。权限、队列、报价、恢复都用免费方式验收。
- 不读取、不打印、不提交任何密钥、Cookie、数据库密码、证书私钥。公司 API Key 只由超级管理员在后台管理；普通成员只能选模型。
- 不停止、不重启、不 bootout 生产机上的守护进程，除非我明确下令。部署和重启先问我。
- 前五个板块保持原样，不顺手改。
- `D:\FG.AI\fg-director-agent` 只读参考，不推送；FG Studio 的改动在新分支上做，推送和合并前先给我看。

## 8. 验收清单

1. 未登录访问美林的任何接口和媒体都被拒绝；两个账号的剧互相看不到，分享后才能看到。
2. 美林的模型菜单与 FG 后台开启的模型一致；关掉一个模型后美林里也消失。
3. 出图、出片前能看到人民币报价和剩余额度；取消就不提交；预算不足时被拦下并说明原因。
4. 提交后断开网络、刷新页面，任务按 FG 任务 ID 恢复，账本里没有重复记录。
5. 每轮对话和每次写剧本、写分段都在账本里有文本记录，归属到正确的人和剧。
6. 费用页的合计与 FG 管理后台对这部剧的账单一致。
7. 用模拟模式完整跑一遍 `npm run smoke`（美林自带），全部通过。
8. 视频任务的提示词里带着该段的参考图绑定和"不生成背景音乐、不生成字幕"。

## 9. 需要我拍板的事

- 入口名称和位置；是否替换现有"短剧 Agent"。
- 默认模型：文本 Claude Sonnet 5.5、出图 Seedream 5 Pro、出片 SD2.5，是否保持。
- 每部剧要不要单独设预算上限，还是只用个人月度额度。
- 第一次付费验收用哪一集、哪几段、什么分辨率。
