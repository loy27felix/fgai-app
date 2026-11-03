<p align="center">
  <img src="production-lab/yingce/canvas/web/public/fg-visual/fg-logo-master.png" width="88" alt="FG Studio" />
</p>

<h1 align="center">FG Studio · FG 超级工作台</h1>

<p align="center">从一句创意，到可管理、可修改、可接续的超级视频制作项目。</p>
<p align="center"><strong>中文</strong> · <a href="README.en.md">English</a> · <a href="docs/releases/2026-10-07--15-user-update.md">本期更新</a> · <a href="production-lab/yingce/canvas/FG-CHANGELOG.md">版本记录</a></p>

[![观看 FG 超级工作台宣传片](docs/media/promo-poster.jpg)](docs/media/fg-studio-tour-1080p60.mp4)

<p align="center"><a href="docs/media/fg-studio-tour-1080p60.mp4">▶ 观看完整宣传片 · 2 分 38 秒 · 1080p / 60fps</a></p>

宣传片展示平台与产品方向；当前已开放能力以本文功能说明为准。

## FG Studio 是什么？

FG Studio 是面向创作者与制作团队的 **AI 视觉创作和短剧制作平台**。它把对话、剧本、角色与场景资产、图片、视频、声音、无限画布、团队项目和费用记录连接起来，让一次生成能够继续成为下一步制作的素材。

你可以只生成一张图，也可以从现成剧本开始，建立统一画风与人物设定，拆分章节和镜头，检查参考图与导演提示词，再逐项或批量制作。项目保留任务、素材、产物版本和费用归属，便于修改、复用以及成员之间接续。

平台同时保留不同工作方式：**短剧 Agent 负责工程化管理，美林负责持续对话共创，自由画布负责开放式组织，广告与小说工作台服务各自的制作流程。** 它们共用 FG 的账号、公司模型接入与存储基础设施，而不是要求成员分别管理多套供应商账号。

## 目录

- [体验与快速开始](#体验与快速开始)
- [真实页面](#真实页面)
- [工作区与功能导航](#工作区与功能导航)
- [短剧 Agent：可管理的制作流程](#短剧-agent可管理的制作流程)
- [美林：通过对话推进制作](#美林通过对话推进制作)
- [画布、灵感与独立生成](#画布灵感与独立生成)
- [广告、综合创作与小说转视频](#广告综合创作与小说转视频)
- [声音、技能与素材复用](#声音技能与素材复用)
- [协作、任务和费用设计](#协作任务和费用设计)
- [模型与个人设置](#模型与个人设置)
- [本期更新与测试反馈](#本期更新与测试反馈)
- [架构与开发](#架构与开发)
- [许可与上游来源](#许可与上游来源)
- [部署与运维附录](#部署)
- [目录速览](#目录速览)

## 体验与快速开始

| 项目 | 内容 |
| --- | --- |
| 体验入口 | [打开 FG Studio](https://218.61.196.139:8300/login) |
| 超级工作台 | [进入创作首页](https://218.61.196.139:8300/fg-six/) |
| 公司局域网 | [内网入口](https://192.168.0.99:3000/login) |
| 公用体验账号 | `test@beva.com` |
| 公用体验密码 | `123456` |
| 体验额度 | **整个账号共用一次性 ¥5**，不是每人 ¥5，跨月不自动恢复。 |
| 体验范围 | 隔离的独立创作、画布和短剧测试；公司故事、共享项目、内部素材、管理和个人密钥设置不开放。 |

外网入口使用现有公司 HTTPS 服务，内网入口仅在公司局域网可达；证书信任按部署要求处理。共享账号的测试内容对其他体验者可见，请只放用于公开体验的内容。额度不足、存在待确认费用或本次费用上限不明确时，服务端阻止新的收费请求；浏览与编辑不因此消失。供应商最终结算和已提交任务可能晚于生成提交时间。

**第一次使用：**

1. 登录后从「超级创作」或「超级自由画布」开始，先浏览灵感、查看设置或上传自己的测试素材。
2. 做完整短剧时，选择「短剧 Agent」；希望边聊边改时，选择「美林 · 超级导演」。两个入口都保留，不需要互相替换。
3. 先确认画风、人物和参考素材，再生成图片；先检查视频提示词、实际引用、规格、单价和合计，再确认出片。
4. 长任务到任务区查看原进度。失败时先保留任务编号并反馈，避免反复新建请求。
5. 正式成员请使用自己的账号；个人 GPT 在账户菜单 → 个人设置 →「GPT 接入」配置。

## 真实页面

以下是 **2026 年 10 月 15 日运行页面截图**，不是设计稿。页面语言、模型选项、示例内容与账号权限可能随配置变化；截图中的测试素材不等于每个模型的效果承诺。

| 创作首页 | 图片工作台 |
| --- | --- |
| ![创作首页](docs/media/screenshots/create.jpg) | ![图片工作台](docs/media/screenshots/image-workbench.jpg) |
| 视频工作台 | 美林 · 超级导演 |
| ![视频工作台](docs/media/screenshots/video-workbench.jpg) | ![美林](docs/media/screenshots/meilin.jpg) |
| 自由画布 | 短剧 Agent |
| ![自由画布](docs/media/screenshots/canvas.jpg) | ![短剧 Agent](docs/media/screenshots/short-drama.jpg) |
| 音频设置区 | 技能中心 |
| ![音频工具](docs/media/screenshots/audio.jpg) | ![技能中心](docs/media/screenshots/skills.jpg) |

镜头制作与独立工作台等更多页面见 [完整截图册](docs/media/SCREENSHOTS.md)。

## 工作区与功能导航

FG 主站保留六个工作区入口，**第六板块「FG 创作工作台」是当前集中迭代的生产工作区**。

| 主站入口 | 用途 |
| --- | --- |
| AI 对话 | 多模型文字／多模态对话、技能调用、推理选项和会话历史。 |
| 项目工作区 | 故事圣经、剧本、角色与场景、镜头、视频、配乐及导出等项目页面。 |
| 超级画布 | 原有创作台、画布、图片与视频生成入口。 |
| 预设库 | 提示词、个人收藏、风格与制作模板。 |
| 管理后台 | 用量、预算、模型、审计日志和服务报表；需相应管理权限。 |
| FG 创作工作台 | 下表中的短剧、美林、广告、综合创作、小说与自由画布等流程。 |

| 超级工作台入口 | 适合完成什么 |
| --- | --- |
| 超级创作 | 一句话开始图片、视频、文本或 Agent 创作，查看最近画布、历史对话与灵感。 |
| 故事与项目 | 投稿、审核、选题、立项，按小组、负责人、级别和预算推进团队制作。 |
| 短剧 Agent | 章节 → 资产 → 分镜 → 视频提示词 → 镜头产物 → 剪辑，集中管理版本。 |
| 美林 · 超级导演 | 持续与 AI 对话，修改全剧设定、剧集、剧本、画风和分段拍摄。 |
| 广告工作台 | 商品／广告需求、创意草稿、专业 Agent、素材和广告项目。 |
| 超级综合工作台 | 在创作运行环境中组织对话、工具、技能、草稿与媒体任务。 |
| 超级小说转视频 | 长文本／小说项目、角色与场景、剧本规划、分镜、生成和剪辑。 |
| 超级自由画布 | 用节点和连线组织素材、生成、参考关系与创意分支。 |
| 资产／音频／图片／视频／技能／插件 | 在具体任务之外管理、查找与复用制作能力。 |

## 短剧 Agent：可管理的制作流程

**导入与章节。** 支持 Word `.docx`、Excel `.xlsx/.xls`、PDF、TXT、Markdown 和 CSV，提供原文与排版预览、章节拆分及整理排版确认。扫描 PDF 需要先提取文字，旧 `.doc` 需另存为支持格式。保留逐章制作，也可选择多个章节批量提取和生成。

**全局设定与资产。** 项目保存画幅、画风和默认模型；画风参考可选 0—6 张。角色、场景、道具分别生成可编辑的资产提示词：角色强调同身份全身三视图，场景强调无人空间，道具强调单件完整展示。支持批量确认、逐项改 Prompt／参考图、统一规格和批量生图，并保留只确认和只保存提示词入口。

**分镜规划。** 根据目标视频模型，按剧情或固定时长拆分片段；一个视频片段可包含多个内部镜头。默认使用 `script-to-drama-prompt-dev`，动作戏结合 `wuxi-action-director-public`，资产提取使用 `short-drama-asset-prompts`。已有分镜默认跳过，覆盖需要明确选择。

**导演提示词。** 每段包含项目／时长／拍法、整体概念、参考图分工、摄影机路线、景深和焦点、材质与色光、人物与背景表演、动作时间轴、声音及负面约束。描述动作先后、速度、接触与受击因果，并记录前段结尾和后段开头的站位、朝向、持物与空间关系。可以填写修改意见、补选技能，先看新草稿再应用。

**参考绑定与检查。** 自动匹配当前片段需要的角色、场景和必要道具，区分身份、结构和风格参考；用户可以检查、调整和重新匹配。匹配能力不能替代人工核对，未准备好或无法读取的素材不会被当成有效引用。

**产物与版本。** 分镜图、动作黑白预演、镜头视频使用独立提示词与历史版本，按「镜头01-分镜图-v1」等名称归档。支持单镜与批量提交，核对真实引用、模型规格、单价、总价与额度，运行中镜头不重复提交。可以从制作区查看当前产物和历史生成时的 Prompt。

新项目默认 **Image 2.5 + Seedance 2.5／480P**；已明确指定的模型保留。提示词改进是制作约束，实际画质、动作与连续性仍需要生成小样和人工审片。

## 美林：通过对话推进制作

美林面向「我想边做边和导演讨论」的工作方式，界面以对话、项目事实、剧集流程和长期记忆共同推进。

- **从零或从已有剧本开始**：从零默认爆款短剧工厂；现成剧本可直接导入，不强制重新填写立项。Google AI Studio 可作为外部起草来源，导入后检查确认。
- **事实可以直接改**：编辑立项卡、剧集圣经、演员／角色、表演红线和全局画风；已有图片、视频不会因改设定自动重生成。
- **连续对话与反馈**：AI 回复和剧本逐步显示；创建、打开、制作时立即给出等待状态。普通建议正常显示，结构化修改另行校验。
- **全剧与分集**：管理全剧资产和长期记忆；修改集数与单集时长、末尾加集、某集后插入或删除。涉及已有剧集的缩减会检查边界，删除有确认。
- **逐段制作**：检查资产、分镜提示词、参考关系与报价后提交，后台沿 FG 任务编号查询状态，保留产物版本及费用。
- **项目接续**：获准进入项目的成员可以继续使用已绑定的素材；管理员协作生成的项目产物不会只对管理员可见。
- **剧目管理**：从首页继续、分享授权或删除自己的剧；共享体验账号禁止向公司内容扩大分享。

| 如何选择 | 短剧 Agent | 美林 |
| --- | --- | --- |
| 主要操作 | 章节、镜头与资产表单 | 对话与可编辑项目事实 |
| 优势 | 批量推进、版本组织、工程管理 | 实时讨论、修改方向、连续记忆 |
| 适用情形 | 结构明确、需要批量和多人接续 | 创意还在变化、需要反复讨论 |
| 共同基础 | FG 模型、任务、人民币费用与素材权限 | FG 模型、任务、人民币费用与素材权限 |

## 画布、灵感与独立生成

**创作首页。** 图片、视频、文本、Agent 四种模式；添加参考内容、@ 素材／技能、选择模型和参数。保留动态小球，右上查看历史对话，下方查看最近画布与灵感大厅。

**灵感大厅。** 按图片、视频、文本，以及用途、来源、模型和关键词筛选；查看提示词、出处与许可，收藏、导入／导出自己的灵感，再将创意带入生成。来源后台定时同步，失败保留上次成功内容。默认网格，可切换「星球漫游」：拖动环顾、滚动靠近、全屏，详情在全屏内展示。重复铺排不会虚增作品数量；第三方内容权利按原来源说明。

**自由画布。** 图片、视频、文本、音频节点与连线，拖动／缩放、参考关系、资源重命名、Agent 辅助、导入／导出与副本。节点拖到边缘自动平移；提示词可展开编辑并 @ 资产，视频规格面板在展开层内操作。视频可提帧、截取片段和提取音频；音频保留名称，便于引用和声线辨认。

**3D 导演台。** 在画布内用人物、基础几何、模型和图片板建立空间，调整姿势、位置、摄影机、灯光和镜头；通过时间线、关键帧及运动路径检查调度，可将预演结果用于后续参考。它用于表达机位与空间关系，不等同于尚待需求验证的 Blender MCP 自动建模。

**图片／视频工作台。** 独立参数区、参考素材、生成结果、进行中任务和历史；工具与预设可按商品主图、细节、广告画面等目标辅助填写。图片尺寸／质量、视频模式／比例／时长／清晰度／音频按模型能力开放，不对所有模型套同一规则。关闭编辑窗口不等于取消后台已提交任务。

## 广告、综合创作与小说转视频

| 工作台 | 流程和设计 |
| --- | --- |
| 广告 | 广告需求与产品信息、创意草稿、专业角色 Agent、素材画布和生成结果；草稿可以回填，任务失败显示原因，费用归入原项目。 |
| 综合创作 | 工具、技能、对话与草稿共同工作；公司技能只读接入，个人工程与运行环境隔离，媒体任务走 FG 模型与费用链路。 |
| 小说转视频 | 从小说／长文本建立项目，组织设定、角色、场景、剧本与镜头，继续生成、剪辑和导出；用户运行环境与工程独立，创建较慢时优先找回原项目。 |

这些入口复用不同上游的专长，保留其工程与流程结构；FG 负责统一登录、公司渠道、报价、额度、任务归属和 NAS 归档。具体工具是否开放由系统配置决定，复杂自动流程、下载站点限制和不同模型效果需要分别验证。

## 声音、技能与素材复用

- **配音和声音生成**：公司 TTS 音色与试听、Seed Audio 文本描述生成声音；格式和长度按渠道能力校验。
- **识别与字幕**：录音文件识别、实时识别、分句文本及字幕导出；断线和失败保留明确状态。
- **翻译**：独立机器翻译入口，用于对白、字幕等文本工作。
- **音乐**：公司 Suno 队列、提交编号、制作／归档状态、已完成作品试听和添加音频节点。公司账号验证码由人工处理，队列就绪不等于供应商一定可生成。
- **技能**：专业编剧、资产提示词、分镜、表演、电影感、商业视觉等完整包；可按工作流选择，不把技能名称当成已执行证明。
- **资产**：个人及获授权公司素材、搜索、预览、版本、项目绑定、回收和恢复。跨项目复用不无条件复制所有文件，删除保留仍被引用的素材。
- **插件**：提供系统已开放的扩展入口；能力和凭据由部署及个人授权决定。

## 协作、任务和费用设计

| 设计 | 用户能得到什么 |
| --- | --- |
| 个人与公司内容分开 | 自由项目按归属隔离，故事项目按协作规则共享；管理角色不代表所有管理员的私人内容互通。 |
| 项目中的素材授权 | 绑定到有权限项目的素材可以接续使用，不把操作者全部私人素材公开。 |
| 编辑占用与接管 | 当前编辑权和接续状态明确，避免多人无提示覆盖同一画布。 |
| 后台任务与恢复 | 保存 FG／供应商任务编号；继续查询已提交任务，不能将等待超时当成可免费重提。 |
| 生成前人民币报价 | 单价、规格、批量合计和剩余额度可核对；不能确定上限的限额请求暂停。 |
| 实际费用与估算分开 | 供应商已确认、价格估算、未知费用分别展示，保留核对证据和人工处理。 |
| 月额度与项目预算 | 普通成员的公司消费受适用预算政策管理；部分公司音频有独立豁免政策。公用体验账号另受一次性硬额度约束。 |
| 回收与归档 | 自由画布 30 天回收站、项目归档、共享引用保护；费用记录不因删项目消失。 |
| NAS 与服务保护 | 媒体按鉴权读取，存储离线暂停写入，不把空目录当成新项目；健康、错误、用量和周期报表可追查。 |

## 模型与个人设置

正式成员从账户菜单进入个人设置，配置个人 GPT 的 **API URL 和 API Key**。默认地址为 `https://api.ten-rings.adtensor.com/llm/v1`，模型 `gpt-6.1-sol`，默认思考 `high`。Key 按账号服务端加密保存，README 不分发个人或公司供应商 Key。

个人 Trings 用量不扣 FG 内部额度，费用与余额以个人上游账号为准。短剧 Agent 未绑定个人 Key 或收到明确额度不足时，可回退 Sonnet 5.5，后者按公司模型政策计费；不会对所有网络错误盲目重发。Image／视频继续使用公司已启用渠道，包括 WeToken GPT Image，不受 GPT 文本迁移影响。

可用模型、最大参考数、比例、像素、时长与报价以当时的模型目录和具体渠道为准；不能把某个型号的限制推广到同名系列全部型号。个人设置还提供主题、资料等入口，权限决定可修改范围。公用体验账号不允许绑定私钥。

## 本期更新与测试反馈

本期从 **v1.2.18／10 月 7 日 v1.3.0 更新至超级工作台 v1.3.17**。完整说明已分为 **新增、改进、修复**，并附时间线、短剧 Agent／美林对比测试和后续方向：

- [10 月 7 日—15 日正式更新说明](docs/releases/2026-10-07--15-user-update.md)
- [main 提交核对索引](docs/releases/2026-10-07--15-commit-index.md)
- [逐版本更新日志](production-lab/yingce/canvas/FG-CHANGELOG.md)

建议用同一段 30—60 秒剧本对比两个短剧入口，重点检查画风、身份、节奏、动作、运镜、段间衔接、引用与任务恢复。反馈包含入口、项目、模型规格、步骤、预期／实际及任务编号。**视频深度参考和 MCP 连接 Blender 仍是征求需求的方向，未承诺开发或效果。** 本地 GPU 后处理默认关闭，详见 [Worker 说明](docs/local-media-worker.md)。

## 架构与开发

```mermaid
flowchart LR
    U[浏览器 / 创作团队] --> F[FG 主站与统一登录]
    F --> G[超级工作台网关]
    G --> C[自由画布 / 短剧 Agent]
    G --> M[美林 / 广告 / 综合创作 / 小说]
    C --> T[任务与模型适配]
    M --> T
    T --> P[公司模型渠道 / 个人 Trings]
    G --> B[报价 / 额度 / 账本]
    C --> D[(PostgreSQL)]
    M --> D
    T --> N[(NAS 媒体与工程)]
```

| 部分 | 技术与职责 |
| --- | --- |
| 主站 | Next.js、React、TypeScript、统一账号与原有工作区。 |
| 超级工作台前端 | React、Vite、TypeScript、Ant Design、画布／编辑器与交互组件。 |
| 原生制作服务 | Go 服务、PostgreSQL、Redis、生成任务及资源处理。 |
| 适配网关 | Node.js：FG 身份、模型、预算、费用、素材与独立工作台桥接。 |
| 独立工作台 | 美林、广告、综合创作与小说运行服务，按项目或账号持久化。 |
| 部署 | Docker Compose、NAS、TLS／代理、自动部署、健康监控与报表。 |

**主站本地开发：**

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

使用项目锁定的包管理器与 `package.json` 依赖要求。数据库、模型接入与 NAS 需独立配置；运行 `pnpm dev` 只启动主站，不会自动启动全部第六板块服务。第六板块说明见 [生产工作台目录](production-lab/README.md)，组件与运行边界以各子目录文档和 Compose 配置为准。

| 目录 | 内容 |
| --- | --- |
| `app/`、`components/`、`lib/` | 主站页面、API、认证、数据与账本。 |
| `production-lab/yingce/` | 超级工作台、原生画布／短剧及 FG 网关。 |
| `production-lab/meilin/` | 美林 FG 适配与原型来源说明。 |
| `production-lab/adcraft/` | 广告工作台。 |
| `production-lab/opencreator/` | 综合创作工作台。 |
| `production-lab/arcreel/` | 小说转视频工作台。 |
| `production-lab/suno/` | 公司音乐队列。 |
| `docker/`、`scripts/`、`tests/` | 数据迁移、运维和验证。 |
| `docs/releases/`、`docs/media/` | 发布说明、宣传片与真实截图。 |

配置字段见 [主站环境变量示例](.env.example) 与 [Docker 示例](.env.docker.example)。数据库、会话、模型、Tunnel 凭据仅放服务端配置；不能将真实 Key 放进 README、示例或截图。更改运行服务前先阅读 [项目约束](AGENTS.md)。

### 问题助手（网页 / 飞书）

代码按模块集中在 `lib/support-bot/`，飞书回调入口在 `app/api/support-bot/`，诊断任务由 `scripts/support-bot-worker.ts` 独立进程处理。同仓库用于复用 FG 的日志和模型能力；当前 worker 直接依赖这些库及数据库，不是可脱离 FG 独立部署的服务。若拆为独立服务，FG 侧应提供受控的只读日志接口，机器人服务负责飞书接入、任务队列、诊断和通知，源码通过只读 checkout 提供。

助手支持飞书和网页自助排查。登录本地 FG 后，在 `/production-lab` 顶部打开“自助排查”；网页复用当前登录账号，无需绑定飞书。`GET/POST /api/support-bot/web` 用于读取本人会话与提交问题，网页会话持久化保存并由同一个 worker 异步诊断，浏览器通过 `GET /api/support-bot/web?conversationId=...&stream=1` 的 SSE 实时展示阶段与已完成查询的公开摘要，最终结论通过证据校验后展示；不流出模型推理、未核实草稿或原始日志。断线自动重连并从持久化快照恢复，连接不可用时降级刷新；关闭弹窗不会取消排查；新问题开启独立会话。网页任务不向飞书投递，使用 `SUPPORT_BOT_ENABLED=true SUPPORT_BOT_SEND_ENABLED=false pnpm support-bot:worker` 可仅处理网页队列。新版 Canvas 的“反馈”旁同样提供入口；它调用同源 FG 接口并依赖 `fg_session`，独立 Vite/Canvas 服务需将 `/api/support-bot/web` 路由至 FG 后端且具备 FG 登录会话，不能直接使用 Canvas 自身的登录 token 替代。飞书机器人采用默认信任模式，无需绑定或登录 FG 账号。私聊可直接发送问题；群内首次发起问题需要 @机器人，机器人会在原消息下创建或续接主题。同一未关闭主题中的群成员可直接回复续问，不需要再次 @；其他群消息不会入队处理。发送「新问题」另建问题，发送「关闭问题」结束当前主题的问题。

网页弹窗限制在当前视口内，对话区独立滚动；输入框、截图与发送操作整合在固定输入区，Enter 换行、Ctrl/⌘+Enter 发送；时间段/定位编号通过“定位信息”浮层补充，不挤占输入框，详细证据默认折叠，结论、处理建议和未核实事项直接展示。排查等待或执行期间禁止继续发送，输入区只读，“发送”切换为“终止排查”；终止成功或任务结束后恢复发送。服务端按当前账号、会话及明确的任务 ID 取消并撤销租约，worker 检测后中断模型请求、不再启动后续取证，已终止任务不得重试或写回结果；已发出的只读查询可能完成但结果不再采用，终止不能撤回供应商已经处理的请求或费用。此能力需要 Web 与 worker 同步更新。每条完成结果提供“复制结果”，一次复制完整回复（包含折叠的证据与查询范围）。实时新消息不会打断用户向上阅读历史。SSE 只推送本人会话的公开内容，代理需保留 `text/event-stream` 与 `X-Accel-Buffering: no` 响应头并禁用该接口的缓冲/转换。迁移先于新版 Web/worker 发布；旧版代码忽略新增 progress 列，可回退代码而无需删除记录。

网页支持选择或粘贴 PNG / JPEG / WebP 截图，最多 10 张、每张 20 MB（按 20 MiB 校验），允许只发截图。发送前可预览和删除，大图在浏览器内逐张缩放/压缩（长边最多 2560px，单图最多 2 MiB），预览即实际提交图片，不保留大图原件。发送后可在当前会话中查看已提交截图；截图读取校验 FG 登录用户及会话归属，会话快照与事件流只返回图片数量，不重复传输 base64。网页 JSON 接口只接收处理后图片（最多 10 张，每张 2 MiB，总请求 28 MiB），避免 10 张 20 MiB 原件转成巨型 base64 请求。截图保存在 PostgreSQL 并发送至所配置的视觉模型，不支持自动遮盖图片内容，请用户上传前移除个人信息、密码和 API Key。纯文字追问沿用同工单最近一组截图；上传新截图时以本轮截图为准，新问题不继承旧图。截图只是用户报告，不替代已核实日志，网页截图中的清晰定位编号可用于当前账号范围的候选查询，但不作为授权依据。网页问题目前仅落库并显示诊断，不自动同步飞书表格或通知开发人员。

调查流程分为“理解问题 → 核对运行版本 → 查询操作数据/日志 → 读取相关实现 → 关联证据与解决步骤”，网页展示真实持久化阶段。服务端采集入队运行快照与登录身份；浏览器提供 Router 实际页面路径、项目和任务/请求/链路定位提示；可选择发生时间段（浏览器本地时区，提交ISO时间，最长7天），不能指定身份或伪造运行版本。Canvas 同时附带当前用户浏览器已有的失败请求元数据（最多20条，选定时间段或最近15分钟），不上传正文、headers或stack；这些仅为客户端定位线索，必须再查询同编号服务端记录，不能视为已核实运行证据。用户补充模块名称时继续解决原问题，不只复述名称。

产品咨询由程序强制执行源码检索；故障排查还强制查询当前用户的操作记录与日志，即使用户暂时没有任务编号也可以查询本人最近24小时的失败候选。源码检索覆盖全仓业务文本，支持按目录/词语缩小、分页和读取附近50行，最多20次工具调用；敏感文件、日志、依赖和构建产物不会进入模型。开发态核对API与worker的checkout和工作树戳后读取含未提交修改的工作树；生产态根据实际部署版本选择对应Git提交，不以HEAD冒充线上代码。无Git、版本不一致或未知时明确标记参考源码，不能确认线上根因。

服务取证不再只有 FG / Canvas 两种来源：目录区分 FG、Production Lab、Yingce 网页、Canvas Go 后端、gateway、独立 Agent，以及 ArcReel、OpenCreator、AdCraft、Meilin、Suno、基础设施和其他仓库代码。源码搜索仍覆盖全仓，目录不限制搜索范围；读取实现后按所属服务单独核对版本，不能把 FG/Canvas 版本套给其他服务。依赖仅提示待查边界，跨服务关联须有双方授权记录的相同定位编号，不能按时间相近或项目相同拼接链路。

已实现的操作适配包括 FG creator、Canvas 任务/流水线、Production Lab 独立业务库的媒体任务与脚本运行记录，以及 Yingce gateway 的音乐、语音任务/用量、Creator、AdCraft、Meilin 和预算回执七类来源。每个来源保留查询范围、归属校验、缺表/缺字段及截断信息；操作回执不是原生请求日志。其他服务的原生日志与独立运行版本尚未全部接入，未配置或不可验证时明确展示缺口，不回退其他服务数据冒充。

操作数据查询只读、参数化并强制验证归属，模型不能提交SQL、URL或userId。FG接入层日志使用当前网页登录身份过滤，日志详情只能来自本轮授权查询；近期记录仅是候选，不会因存在一个错误就认定是本次故障。Canvas是独立业务运行服务：需要显式配置其只读数据连接与运行版本接口，缺少任一项都会在答复中展示缺口，不用FG同名任务或FG版本替代。故障按用户编号或时间窗口查询后，程序使用 `chain` 沿真实返回的 taskId/requestId/traceId 展开（每条链最多6个编号查询，保留查询范围、截断与失败标记），读取失败节点的脱敏错误摘录。多个编号条件按交集查询，扩展每一跳仍验证归属。Canvas 查询原生 `task_logs` / `api_call_logs`，不以FG接入层日志冒充Canvas请求；其中上游API审计不等于入站HTTP日志。Canvas AccessLog、gateway HTTP与独立Agent运行事件通过各自原生结构化日志接入，身份仅来自服务端已验证会话或内部服务鉴权；未配置日志源或只有旧格式时仍显示缺口，不能补造历史记录。飞书未绑定FG账号时保留按用户文字提供的taskId/requestId/traceId及其已返回关联编号查询的信任模式，不开放无编号全站扫描。

答复分别列出结论、原因/功能依据、解决步骤、实际证据及未核实项。故障不再接受 `likely` 结论。确认根因必须有本次编号关联的真实请求链、具体错误与已读取实现的原文核对以及匹配运行版本；单个状态码、失败任务或“代码存在某机制”不足以确认。证据不足时由服务端只渲染实际查询范围、记录、源码位置与缺失证据，不发布模型猜测的原因或修复步骤；产品功能咨询仍可以说明源码依据。不自动修改业务数据、重新生成任务、执行Shell/SQL或操作生产守护进程。负责人通过 `SUPPORT_BOT_MODULE_OWNERS` 映射，仅飞书入口执行已有通知流程；网页排查与调查证据保存在数据库，不虚称已通知开发。


服务端配置见两个环境变量示例中的 Feishu support bot 段落：

**先选环境，再配置数据源。** Web 与 worker 必须显式设置 `SUPPORT_BOT_ENVIRONMENT=local|production`，不能靠地址或 `NODE_ENV` 猜测。`local` 只接受 loopback（`localhost`、`127.0.0.1`、`[::1]`）业务数据库及版本 URL，并禁止飞书外发，`SUPPORT_BOT_SEND_ENABLED` 必须保持 `false`；Docker 服务名、局域网地址和远程数据库不属于 loopback。loopback 隧道也不能绕过数据库环境标记。**loopback 限制仅针对业务数据库和原生版本源，不限制单独配置的模型供应商 URL；本地真实模型验证会调用已配置供应商，不代表离线运行。生产模型凭据由运营单独准备，不从 `.env.local` 复制。** `production` 还要求进程的 `NODE_ENV=production`；Dockerfile 已设置不代表宿主机启动的 worker 也已设置，未满足时检查失败，不能称生产就绪。

FG 主库、Canvas/gateway 业务库和独立 Production Lab 库都必须具备与所选环境一致的**数据库级 GUC** `fg.support_environment='local'` 或 `'production'`。先确认目标实例、数据库名称及用途，再由该库 owner 执行 `ALTER DATABASE "<已确认的目标库>" SET fg.support_environment = 'local'`（生产使用 `'production'`），新连接后验证；这是经确认的配置操作，不是迁移自动设置，也不能通过连接 URL、角色级或会话级 `SET` 冒充数据库标记。缺失或不匹配时停止接入，不通过重标记未知数据库让检查通过。本地 `.env.local` 与生产 `.env.docker` **不互拷**，分别准备本环境连接、凭据、日志挂载及版本地址，应用和 worker 的标识须一致。

1. 在飞书开放平台创建应用并启用机器人，配置 App ID、App Secret、Verification Token 和 Encrypt Key；事件订阅地址为 `https://你的域名/api/support-bot/events`，订阅 `im.message.receive_v1`。开通接收私聊、群内 @消息、`im:message.group_msg`（读取机器人所在群的全部消息，敏感权限）、发送消息和 `im:message.reactions:write_only`（发送消息表情回复）权限。新消息入队后机器人会立即给原消息添加 GET 表情，诊断完成后再回复结果；表情 API 超时或权限不足不会阻断工单处理。启用群入口还需配置机器人自己的 `FEISHU_SUPPORT_BOT_OPEN_ID`。可用 `FEISHU_SUPPORT_TENANT_KEY` 限定租户。
2. 多维表格可选，需给应用访问表格的权限，同时配置 App Token 和 Table ID。建以下**文本列**：问题编号、问题描述、诊断摘要、模块、状态、用户ID、消息ID、证据摘要。其中用户ID记录提问者的飞书 open_id。表中保留内部诊断信息，应仅供支持和开发人员访问。
3. `SUPPORT_BOT_MODULE_OWNERS` 是模块名到开发人员 `open_id` 的 JSON 映射，例如 `{"default":"ou_xxx","billing":"ou_yyy"}`。未配置负责人时只记录问题，不发送开发通知。问题排查默认使用 `gpt-6.1-sol`，截图理解、取证规划和最终诊断均默认使用 `high` 思考等级。通过 `SUPPORT_BOT_REASONING_EFFORT` 可设为 `low/medium/high/xhigh/max`，或用 `auto` 保留上游默认值；具体等级需模型与供应商支持，非法配置会报错而不会静默降级。Responses 传递 `reasoning.effort`，Chat Completions 传递 `reasoning_effort`；调整后需重载相应 Web/worker 进程，较高等级可能增加耗时与 token 用量。可配置 `SUPPORT_BOT_API_BASE_URL`（OpenAI-compatible API 根地址，含 `/v1`）和 `SUPPORT_BOT_API_KEY` 单独指定供应商，未配置时回退到 Wetoken 的 `WETOKEN_BASE_URL`、`WETOKEN_API_KEY`。`SUPPORT_BOT_API_PROTOCOL` 默认 `chat_completions`；Codex 通道应设置为 `responses`，使用官方 SDK 流式请求 `/responses` 并设置 `store=false`。`SUPPORT_BOT_MODEL_ID` 指定模型 ID；Responses 模式直接使用该 ID，Chat Completions 模式使用项目模型目录中的 ID。
4. 应用与 worker 使用同一个数据库，按既有启动迁移执行 `016-support-bot.sql`、`017-support-bot-group-topic-index.sql`、`018-support-bot-images.sql`、`019-support-investigation.sql` 和 `020-support-stream-progress.sql`；这些迁移不负责设置环境 GUC。在项目 checkout 内安装锁定依赖，将开发配置放 `.env.local`，先执行下方 `--check`，再运行 `pnpm support-bot:worker`；单次处理用 `pnpm support-bot:worker --once`。worker 不读取 `.env.docker`，生产须由运行环境注入相应变量，运行时环境变量优先于 env 文件；不能让生产 worker 误读本地配置。另一种调度方式是由受信任调度器 POST `/api/support-bot/process`，携带 `Authorization: Bearer SUPPORT_BOT_WORKER_TOKEN`，每次最多处理一条；无需同时运行两种调度器。
5. `SUPPORT_BOT_ENABLED=true` 开放接收；`SUPPORT_BOT_SEND_ENABLED=false` 时 worker 和 `/api/support-bot/process` 只处理网页队列，仍会调用诊断模型；设为 `true` 才同时处理飞书队列及外发飞书消息。默认均关闭，不会自动安装或重启生产服务。
6. 可选接入Canvas：`SUPPORT_BOT_CANVAS_DATABASE_URL` 指向对应环境的PostgreSQL，必须使用仅SELECT权限账号；读取映射表和本人任务/项目，不会建立Canvas session或执行DDL。`SUPPORT_BOT_CANVAS_VERSION_URL` 指向同一部署受信的版本接口（需返回可验证Git commit）；地址只来自服务端配置，不接受用户或模型指定。没有连接时仍可做源码咨询，但Canvas实际操作/线上根因不能宣称已核实。不要将生产连接配置进本地测试环境。
7. 可选接入 Production Lab：`SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL` 指向同环境独立业务库的只读账号；未配置时读取既有 `PRODUCTION_LAB_DATABASE_URL`，绝不回退 FG 主库。gateway 回执复用 `SUPPORT_BOT_CANVAS_DATABASE_URL`，必须存在 active 账号映射，查询同时校验任务及项目归属。所有适配只读，不建表、不创建服务会话；不会把这些业务记录作为未接入的入站 HTTP 日志。
8. 独立版本按服务配置：`SUPPORT_BOT_YINGCE_GATEWAY_VERSION_URL`、`SUPPORT_BOT_YINGCE_AGENT_VERSION_URL` 指向各自 `/health/version`，`SUPPORT_BOT_YINGCE_WEB_VERSION_URL` 指向实际网页构建的 `/.well-known/fg-runtime.json`；Canvas 使用 `/api/system/version`。worker 必须能直达这些同环境地址，不把 FG 页面代理结果当作独立服务版本。读取固定安全字段 `service/build.commit/build.version/build.environment/build.dirty`；`local` 对应构建环境 `development`，`production` 对应 `production`，缺失或不匹配即拒绝。生产只有服务身份正确、production、clean 且对应提交源码可用才签认；dev/dirty 明确标记仅供参考，旧 Canvas 缺少身份/clean 证明也不签认。其他服务同样使用 `SUPPORT_BOT_<大写服务名，连字符换下划线>_VERSION_URL`，但前提是其真实端点实现该合同，不能仅填一个地址就称已接通。
   构建独立镜像时必须传入真实 `BUILD_VERSION`、`BUILD_COMMIT`、`BUILD_TIME`、`BUILD_DIRTY`；clean 状态应由构建时 checkout 检测，不能默认填 false。现有 gateway Compose 构建读取 `CANVAS_BUILD_*`，backend/agent/web 仍使用预构建镜像，须在各自构建流水线传入上述参数；此功能不会自动重建、推送或部署镜像。
9. `SUPPORT_BOT_NATIVE_LOG_SOURCES` 是仅服务端配置的 JSON，例如 `{"canvas":{"file":"/var/log/fg/canvas.jsonl"},"yingce-gateway":{"container":"gateway"},"yingce-agent":{"file":"/var/log/fg/agent.jsonl"}}`。每服务只能选择一个绝对路径 JSONL 文件或可信容器名。优先由部署侧将日志目录只读提供给 worker；容器模式要求 worker 已具备 Docker CLI/context，不自动挂载 Docker socket、不接受模型指定命令/路径/容器。原生事件含 service、鉴权用户、request/trace、状态及当时 build commit/dirty，正文和凭据不进入调查结果。**日志必须带 `build_environment`，且与所选环境匹配：local → development，production → production；缺失或不匹配的记录不作为证据，不能因日志文件可读就判 ready。** Canvas/Agent 需 active 原生账号映射，gateway 使用 FG 已鉴权用户；匿名和仅伪造用户Header的事件不纳入本人记录。Canvas 设置 `CANVAS_LOG_FORMAT=json`；默认 info 不记录成功 GET 等低级别事件，需要完整请求跟踪时由运行环境显式配置 `CANVAS_LOG_LEVEL=debug`。
10. 原生日志每次最多读取2MiB/5000行并返回100条，按本人及指定编号/时间交集筛选；不虚构项目归属，不支持显式项目条件时会拒绝而非静默忽略。轮转、日志级别、截断及改版前未采集的请求都可能造成历史缺口。报告核对事件中的 build commit/dirty 与对应源码，不以今天的运行版本冒充旧请求版本。浏览器静态站可核对自身构建，但没有独立服务器业务库；其他独立产品是否运行须分别核实，不能因仓库有目录就宣称正在运行或已接入。

**独立产品接入缺口（源码调查，不是部署验收）：** `lib/support-bot/services.ts` 的 `data: 'unavailable'` 不代表没有原服务。下列五产品尚无可直接供助手使用的完整原生合约版本端点、日志合同和受信账号映射；部分已有健康接口或内部账号隔离，但仅填地址不能变为 ready。

| 产品 | 原生运行入口与数据来源 | 助手尚缺的证据 |
| --- | --- | --- |
| ArcReel | `production-lab/arcreel/deploy/entry.py`：每用户 Python 服务，gateway 代理；独立 `/state/arcreel.db`，工程根下 `logs/arcreel.log`。 | 实例归属、原生版本/日志合同及只读数据适配，不能用 gateway 回执代替。 |
| OpenCreator | `production-lab/opencreator/deploy/entry.mjs`：共享网页 + 每用户 daemon；`/state/opencreator/data/app.sqlite` 及 dataDir 下 `runs/`。 | 实例归属与原生合约；wrapper 过滤普通 stdout/stderr，Docker 输出不等于 run 日志。 |
| AdCraft | `production-lab/adcraft/upstream/apps/api/fg_main.py`：iframe + gateway + 独立 API/Web/Agent；`/database/<workspace>/v2/adcraft.sqlite3`。 | 各组件版本、原生请求/执行日志及 workspace 归属适配。 |
| Meilin | `production-lab/meilin/upstream/server/fg-server.mjs`：iframe 经 gateway 进入独立服务；`production-lab/meilin/upstream/schema.sql` 的 `fg_meilin_dramas`、`fg_meilin_members`、`fg_meilin_events`。Compose 需显式启用 `meilin` profile。 | 原生版本/日志及账号权限数据适配；`npm run dev` 的原型入口不是 FG 集成验收。 |
| Suno | `production-lab/suno/server.ts`：独立适配服务调用外部 Suno；`/state/<operation-id>.json` 和 MP3，当前协议在 `current-api.mjs`。 | operation 到账号的受信映射及合约版本/日志；供应商模型目录不是适配器版本。 |

Yingce 已有 Web 构建清单、Canvas `/api/system/version`、gateway/Agent 各自 `/health/version` 及后端原生事件，仍须逐环境验证配置、身份、构建与日志标记。gateway 的 Creator/AdCraft/Meilin/Suno 提交或任务回执只证明网关侧事实，不代表原服务请求、执行结果或部署版本；`infrastructure`、`repository` 只是分类，不是两个独立运行产品。

**生产配置准备顺序（仅清单，不表示已上线）：**

1. 保持 `SUPPORT_BOT_ENABLED=false`、`SUPPORT_BOT_SEND_ENABLED=false`。独立准备生产私密配置，明确 `SUPPORT_BOT_ENVIRONMENT=production` 和 `NODE_ENV=production`；未核对实际进程前，不认为 Dockerfile 的默认值已经生效。**环境检查为 fail-closed：新代码生效后，生产缺少环境变量或 FG 主库标记、标记不匹配时，support 接口会返回 503，worker 检查也会失败。必须在启用前准备好配置，不能上线开放后再补标记。**
2. 确认 FG `DATABASE_URL`、`SUPPORT_BOT_CANVAS_DATABASE_URL`、`SUPPORT_BOT_PRODUCTION_LAB_DATABASE_URL`（或其回退 `PRODUCTION_LAB_DATABASE_URL`）的真实目标，再由各库 owner 设置数据库级 GUC，准备所需 schema 和角色授权。业务证据连接使用 SELECT-only 账号；FG 主库还承担队列与会话持久化，不能一概改成只读账号。
3. 单独注入模型配置：`SUPPORT_BOT_MODEL_ID=gpt-6.1-sol`、`SUPPORT_BOT_REASONING_EFFORT=high`、`SUPPORT_BOT_API_PROTOCOL=responses`，以及 `SUPPORT_BOT_API_BASE_URL` / `SUPPORT_BOT_API_KEY`；留空会回退 `WETOKEN_BASE_URL` / `WETOKEN_API_KEY`，也须确认属于预期供应商。生产示例显式选择 Responses，不等同于 `.env.example` 的通用协议默认值。
4. 准备 `SUPPORT_BOT_CANVAS_VERSION_URL`、`SUPPORT_BOT_YINGCE_GATEWAY_VERSION_URL`、`SUPPORT_BOT_YINGCE_WEB_VERSION_URL`、`SUPPORT_BOT_YINGCE_AGENT_VERSION_URL` 及 `SUPPORT_BOT_NATIVE_LOG_SOURCES` 的同环境地址/只读挂载，验证原服务身份、账号映射与构建环境；不填真实地址到示例，不把五产品的缺口隐藏为已接通。
5. 由获准的发布流程向 Web 和 worker 注入一致的生产配置，建立新连接，保持接收与外发关闭，先执行下方 `--check`，再执行与获准范围一致的 `preflight --require=...`。确认所需项 ready 并记录其余缺口后，才另行授权启用接收并验证实际 API；只有准备好 `SUPPORT_BOT_WORKER_TOKEN`、`FEISHU_SUPPORT_*` 应用/租户/表格变量和 `SUPPORT_BOT_MODULE_OWNERS`、核验飞书权限后，才按需授权生产外发。本地始终禁止飞书外发；本清单不授予启动、重启、部署或生产验证权限。


问题、诊断证据、队列租约和各外发步骤结果保存在 PostgreSQL；多维表格按问题编号同步。回复、表格同步、开发通知独立尝试，某个通道失败不会阻断其他通道，重试跳过已成功通道并复用诊断结果。网络中断在远端成功而本地尚未记账的极小窗口仍可能造成重复通知，使用飞书消息 UUID 做额外去重。文字模型输入和外发内容统一脱敏，截图原图不会自动脱敏；关键词按字面全文检索，不能改写定位条件。故障确认须关联同一业务服务、本次定位编号对应的完整请求证据与匹配运行版本的源码；版本未知、仅近期候选或链路不完整时仅展示已查事实，不能换成低置信度标签后继续发布推测正文。已有源码命中时，即使证据不足也要实际读取相关业务实现；文档、测试和搜索摘要不能代替运行实现。产品咨询不套用故障结论。每个飞书身份或网页登录账号有提问与排队上限，持续失败的任务最多尝试四次，最终失败保留在 `support_bot_jobs` 供管理员排查。数据库保留期限遵循现有备份与数据管理策略，需清理时先备份，不能将问题表当作唯一事实来源。

本地代码验证可运行 `pnpm exec tsc --noEmit --incremental false`、`pnpm build`；连接检查使用 `SUPPORT_BOT_ENVIRONMENT=local SUPPORT_BOT_SEND_ENABLED=false pnpm support-bot:worker --check`。`--check` 只读验证 **FG 主库连接、数据库级环境标记及问题助手所需表字段**，不设置 GUC、不调用模型、不处理队列或外发；通过不代表 Canvas、gateway、Web、Agent、Production Lab 或五个独立产品已接通。生产仅在另行授权且注入生产配置后，使用 `NODE_ENV=production SUPPORT_BOT_ENVIRONMENT=production SUPPORT_BOT_SEND_ENABLED=false pnpm support-bot:worker --check`；不能拿本地成功代替生产核验。

**数据源预检：** `pnpm support-bot:preflight [--require=fg,production-lab,canvas,yingce-gateway,yingce-web,yingce-agent]` 只读输出脱敏覆盖矩阵，列出服务、是否 required、环境、数据源/版本/日志检查结果、ready 与缺口原因。不输出连接串、地址、密钥或原始日志，不调用模型、不处理队列或外发。配置好本地数据源后，可重复运行：

```sh
SUPPORT_BOT_ENVIRONMENT=local SUPPORT_BOT_SEND_ENABLED=false pnpm support-bot:preflight --require=fg,production-lab,canvas,yingce-gateway,yingce-web,yingce-agent
```

预检验证数据库级环境标记、所需表存在及 SELECT 权限；对 Canvas 和 Production Lab 证据连接，还检查所需表上没有 INSERT/UPDATE/DELETE/TRUNCATE 权限，不执行实际写入。独立服务检查原生版本身份、构建环境及日志服务/事件/`build_environment` 的同环境格式；静态网页只检查自身版本，不虚构业务库或服务器业务日志。**它不扫描实际账号业务记录，不保证每个账号的 active 映射存在，也不是完整模型业务流验收。FG 运行项（Production Lab 复用）来自执行 preflight 的本进程 checkout 快照，不是 Web 远端进程探针**，不能据此证明已运行的 Web/worker 与该 checkout 相同；实际账号权限、映射和业务请求仍需在获准范围内另验。

显式 `--require` 时，仅所需项未 ready 才因覆盖缺口退出非 0，其他缺口仍列出，退出 0 仅表示所选范围通过；参数或全局环境配置无效也会失败。**未指定 `--require` 时，全部真实产品/服务默认 required，包含上述五产品，未接入就不能输出 all-pass，须退出非 0**；`infrastructure`、`repository` 分类桶不参与。上述六项本地数据源预检已通过；默认全服务预检退出 1，并明确列出五产品接入缺口。这是数据源配置/格式层的结果，不代表全产品可用、每个账号映射已验证、完整模型业务流通过或生产已验收。

真实飞书连通、权限和表字段需要生产配置与单独授权才能核验；不要在聊天或仓库中提交真实凭据。本地预检通过不能替代生产环境核验，也不表示生产上线已经完成。

运行日志通过现有结构化日志器输出，`service` 为 `support-bot`，记录接收、忽略原因、入队、诊断与投递阶段，不记录消息正文或飞书凭据。本机联调可将 Web 与 worker 标准输出分别保存到 `.logs/support-bot-web.log` 和 `.logs/support-bot-worker.log`，使用 `tail -f` 实时查看；日志文件由 Git 忽略。飞书后台的「日志检索 → 事件日志检索」用于核对平台是否成功投递，HTTP 200 不代表事件一定进入诊断队列。

## 许可与上游来源

FG 自有主站代码的许可见 [根目录 LICENSE](LICENSE)。**完整仓库包含许可不同的第三方组件，不应将整套系统简单视为全部 MIT：**

| 组件 | 原始许可／来源 |
| --- | --- |
| Open AI Canvas 及 FG 画布适配 | [MIT 与署名](production-lab/yingce/canvas/LICENSE) |
| 综合创作 OpenCreator | [Apache-2.0](production-lab/opencreator/upstream/LICENSE) |
| 小说转视频 ArcReel | [AGPL-3.0](production-lab/arcreel/upstream/LICENSE) · [来源记录](production-lab/arcreel/SOURCE.md) |
| 广告 AdCraft | [个人及非商业许可](production-lab/adcraft/upstream/LICENSE)，商业使用需按原许可取得相应授权。 |
| 美林 | [原型来源与改造边界](production-lab/meilin/SOURCE.md)，保留原有贡献与技能署名。 |

外部灵感、音乐、字体、模型输出和技能分别遵循其权利人与供应商条款。部署、分发或商用前应逐项核对相关组件许可；平台提供工作流不替代内容授权。

---

下方保留原有部署与运维内容，供维护者继续补充；本次重写不改动此附录正文。

## 部署

生产部署使用 Docker Compose。

### 局域网 Docker + NAS 部署

局域网部署使用纯本地 Docker 服务，应用和 PostgreSQL 由仓库根目录的 Compose 文件管理，数据库使用独立 Docker volume，不要把数据库目录放在普通 SMB 共享上。基础 `docker-compose.yml` 使用只读隔离媒体卷；只有 NAS 已确认挂载并通过容器内读写探测时，才附加 `docker-compose.nas.yml` 绑定真实媒体目录。

1. 在 Docker 主机挂载 NAS 目录，并确保 Docker daemon 有读写权限。未挂载时，宿主机上的空挂载点必须保持只读，避免媒体误写到本地磁盘。
2. 复制 `.env.docker.example` 为 `.env.docker`，填写 `POSTGRES_PASSWORD`、`NAS_MEDIA_PATH`、`NAS_EXPECTED_HOST`、`NAS_EXPECTED_SHARE`、`NAS_MOUNT_URL` 和 `CLOUDFLARE_TUNNEL_TOKEN`。`NAS_MEDIA_PATH` 填 Docker 宿主机上的绝对路径，例如 `/Volumes/FgStudio/media`；`NAS_EXPECTED_HOST` 和 `NAS_EXPECTED_SHARE` 分别填写 NAS 固定地址与共享名；`NAS_MOUNT_URL` 填不含密码的 SMB URL，凭据必须保存在宿主机当前账号的 Keychain。Compose 会把宿主机目录挂载到容器内的 `/data/media`，不要把容器路径写入该变量。
3. 在 Cloudflare Tunnel 的 Published application 中，把 Service URL 配置为 `http://app:3000`。`cloudflared` 与 App 在同一个 Docker network 中，不能填写宿主机的 `localhost`。
4. 把 Tunnel 的公网 HTTPS 地址写入 `PROVIDER_MEDIA_URL`，例如 `https://media.example.com/api/local/storage/content`。启用本地 TLS 代理后，`LOCAL_MEDIA_URL` 使用 `https://192.168.0.99:3000/api/local/storage/content`；局域网客户端需要信任该证书，Wetoken 仍使用 Tunnel 地址。App 服务端代理会自动把本地媒体 URL 改走容器内 HTTP（production 默认 `http://app:3000`，development 默认 `http://127.0.0.1:3000`）；如容器内监听地址不同，可配置 `LOCAL_MEDIA_INTERNAL_URL`。
5. 生产主机启用 Docker Nginx TLS profile，并设置 `FG_COMPOSE_PROFILE=https`、`COMPOSE_PROFILES=https`、`FG_APP_HOST_PORT=3001`、`FG_NGINX_HOST_PORT=3000`、`FG_NGINX_CERT_PATH` 和 `FG_NGINX_KEY_PATH`。NAS 挂载和读写探测通过后执行 `mkdir -p "$HOME/Library/Application Support/fg-studio-nas-state" && docker compose --file docker-compose.yml --file docker-compose.nas.yml --env-file .env.docker --profile https up -d --build`，用户通过 `https://192.168.0.99:3000` 访问；Nginx 转发至 App 的 `3000`，Cloudflare Tunnel 仍在 Docker network 内直连 App。

常用 Docker 命令已集成到 `package.json`，均应在实际 Docker 主机的项目目录执行：

这些快捷命令默认使用基础离线 Compose；NAS 媒体卷由守护进程在挂载和读写探测通过后切换启用。手工部署需附加 `docker-compose.nas.yml`，HTTPS 部署命令见步骤 5。

```bash
pnpm docker:config        # 校验 Docker Compose 配置
pnpm docker:ps            # 查看 App、PostgreSQL 和 Tunnel 状态
pnpm docker:up            # 构建并启动全部服务
pnpm logs:docker          # 持续查看全部容器最近 200 行日志（含时间戳）
pnpm logs:app             # 只看 Next.js App 与服务端业务日志（含时间戳）
pnpm logs:app:history     # 列出自动部署归档的 App 历史日志
pnpm logs:postgres        # 只看 PostgreSQL 日志（含时间戳）
pnpm logs:tunnel          # 只看 Cloudflare Tunnel 日志（含时间戳）
pnpm logs:monitor         # 查看统一服务状态与新增业务错误告警
pnpm logs:audit           # 查询最近 168 小时的持久化业务审计事件
# 浏览器访问 /admin/logs    # SLS 风格统一检索 audit、server、frontend、infra 事件
pnpm reports:run          # 立即触发一次到期报表检查（仅调用内部 endpoint）
scripts/audit-events.sh all  # 查询 audit_events 全部历史
```

日志命令会持续跟随新输出并显示 Docker 时间戳，按 `Ctrl+C` 退出，不会停止容器。排查 App 内的具体链路时，可继续按现有日志标识过滤：

```bash
pnpm logs:app | grep '"event":"creator_image"'  # 图片生成与供应商请求
pnpm logs:app | grep '"event":"creator_video"'  # 视频生成、提交与轮询
pnpm logs:app | grep '"event":"local_media'      # NAS 媒体鉴权、读取与失败
```

本地执行 `pnpm dev` 时，App 日志直接输出在当前终端，并异步写入 `observability_log_events`；浏览器错误、画布异常和必要的创作台诊断会通过观测入口进入数据库，剩余浏览器运行时日志仍在 DevTools Console 中查看。

业务审计事件保存在 PostgreSQL 的 `audit_events` 表中；普通服务日志和浏览器观测事件分别保存在 `observability_log_events` / `observability_error_events`。管理员可从 `/admin/logs` 统一检索，详情显示完整的安全序列化事件 JSON。每条业务审计记录包含 `event_id`、`trace_id`、操作者、workspace、feature/action、资源、阶段、前后状态、结果、耗时、脱敏后的参数/数据和错误摘要；视频任务同时保留在 `creator_generation_task_events`。应用会在 stdout 输出同一个事件 ID，便于把实时日志与数据库历史关联。Prompt、完整 URL、signed URL、token、密码、API key、图片/视频二进制不会写入审计事件。

实际运行 Docker 的 macOS 宿主机必须安装 NAS 守护进程；不要在开发机或仅用于编辑代码的机器上执行：

```bash
chmod +x scripts/nas-supervisor.sh scripts/install-nas-supervisor.sh
scripts/install-nas-supervisor.sh
```

安装脚本会在终端要求输入一次 NAS 密码，并仅保存到当前运行账号的 macOS Keychain。守护进程每 10 秒校验 SMB 挂载、NAS 主机、读写探针和容器内标记。NAS 不可用时，`app` 仍可冷启动或保持运行：离线容器只挂载独立、只读的 Docker volume；运行中的容器通过只读挂载的 `~/Library/Application Support/fg-studio-nas-state/disabled` 本地标记关闭后续媒体 I/O，媒体操作返回 `503`，其他功能继续服务。守护进程从专用 Keychain 条目读取凭据后以无界面方式重新挂载，不会弹出 Finder 登录窗口；只有真实 NAS bind mount 的新容器读写探测通过后，才切换挂载、清除禁用标记并 `--force-recreate` 重建 `app`。PostgreSQL 始终保持运行。执行 `pnpm logs:nas` 可同时跟随标准与错误日志。

### main 分支自动重部署

由于 Docker 主机位于局域网内，GitHub 无法直接访问它，自动部署使用部署主机上的用户级 LaunchAgent 轮询 `origin/main`。只在实际 Docker 主机 `/Users/server/work/fgai-app` 执行，不要在开发机安装：

```bash
chmod +x scripts/auto-deploy.sh scripts/install-auto-deploy.sh
scripts/install-auto-deploy.sh
```

服务每 30 秒检查一次 `origin/main`；NAS 状态不会阻止新版脚本 fetch、build 或启动 App。若主机仍运行日志输出 `NAS mount is not ready; waiting` 的旧版脚本，它会在 fetch 前退出，无法靠自动部署自更新；此时需先进行一次主机脚本引导更新，或等 NAS 恢复后再由旧流程拉取修复。NAS 缺失或读写探测失败时，部署使用隔离的只读媒体卷，NAS 媒体接口保持关闭；真实 NAS bind mount 通过新容器读写探测后才会启用。脚本会为本次构建生成独立的 `deploymentVersion`（UTC 时间加 commit 短 SHA），通过 Docker build arg 写入 App，并等待容器 health、无需登录的轻量 `/api/version` 健康接口返回成功且版本一致。代码 fast-forward 后，脚本会重新执行刚拉取的最新脚本，并在 `docker compose build` 时显式传入版本参数，避免部署进程继续使用旧脚本或 Compose 默认值 `dev`。完整构建输出保存到宿主机 `$HOME/Library/Logs/fg-studio-auto-deploy-build/`，构建失败时主部署日志会输出尾部摘要，并在自动部署状态目录的 `failed-detail` 文件中保留失败阶段和完整日志路径。它随后执行 `002-local-upgrade.sql`，再由 App 启动命令中的 `local-db-migrate.mjs` 按 checksum 幂等执行版本化迁移，重建 `app` 后会校验并平滑 reload bind-mounted Nginx 配置。构建、数据库升级、App health 或 Nginx reload 失败时会回退到上一提交，并记录失败 SHA，避免同一个坏提交反复重启服务。

项目系统版本维护在 `lib/version.ts` 的 `SYSTEM_VERSION`，这是用于强制升级判断的三段式 semver，必须由代码变更人工递增；每次发布新版本必须同步更新 `package.json` 的 `version`、`SYSTEM_VERSION`、`fg-release-notes.ts` 的 `CURRENT_RELEASE_VERSION`，并新增对应版本的中文更新说明。例如将 `1.0.0` 改为 `1.0.1` 后提交并推送，自动部署完成即提高最低可用版本，自动部署不会修改它。所有页面右下角会展示系统版本和部署版本，`/api/version` 返回两者及当前要求的系统版本。旧页面会立即检查并每 60 秒复查；检测到当前页面系统版本低于服务端要求时会阻断页面并提示刷新升级。版本接口暂时不可用时页面放行，避免诊断链路故障阻断正常使用。

正常部署、回滚和 NAS 重建 `app` 时，脚本在持有重建锁后先通过 `docker logs --follow --timestamps` 跟随旧容器 stdout/stderr，再替换容器，避免遗漏替换前的最后日志。首条完整时间戳日志或正常 EOF 用于确认跟随；无日志容器通过受限日志查询、同容器运行状态和跟随进程存活复核，无法确认时推迟替换。空日志复核属于 best-effort，Docker CLI 不提供空流连接确认。归档 CLI 最长运行 150 秒，重建 CLI 最长运行 120 秒，仅清理本次启动的进程；重建超时不能证明 Docker daemon 的操作已结束，脚本保留日志和状态告警，本轮不再盲目回滚或降级替换。日志先写私有临时文件，再原子发布到宿主机 `$HOME/Library/Logs/fg-studio-app/`；异常或超时捕获的完整行保留为 `*-partial.log`，并输出警告。新容器启动失败时也会归档失败容器日志。监控按独立游标补采错误；该目录不随容器删除，使用 `pnpm logs:app:history` 查看历史归档文件。

执行 `pnpm logs:deploy` 可同时跟随自动部署的标准与错误日志。部署主机必须能够访问 Git remote；私有仓库的 Git 凭据应配置在该主机的 Git credential helper 或 SSH agent 中，不要写入仓库或 `.env.docker`。

服务器网络如果封锁 UDP/7844，Compose 会强制 `cloudflared` 使用 HTTP/2，避免 Tunnel 自动切换到不可用的 QUIC。Tunnel 的 Compose 配置变更必须在明确授权的维护操作中重建容器后生效；单纯 `restart` 不会更新已有容器的 healthcheck，监控不会主动重建或重启隧道。

### 服务监控与告警

Docker 主机使用统一 LaunchAgent 每 30 秒检查 Docker、NAS、App HTTP、PostgreSQL、Cloudflare Tunnel、系统磁盘和 App 新增 `error/fail` 日志。`tunnel` 单独记录 connector 就绪状态，`public-media` 单独探测 `PROVIDER_MEDIA_URL`；连续 2 次失败后分别告警，公网超时不会被归因为 connector 断开，也不会触发隧道重启。隧道与公网媒体在健康和异常状态下均保留采样心跳，通过持久 outbox 投递；日志页面隐藏这两类服务明确标记的重复异常心跳，告警仅在状态变化时触发。监控 Docker CLI 调用最多等待 5 秒，公网探针验证 TLS；仅 2xx 或无参数媒体内容接口的预期 400 算可达。入队失败保留状态并继续其他检查。App 错误合并 stdout/stderr 后按容器游标采集到 outbox，归档每轮补采一份、最多 100 行。不同事件队列轮换投递，失败事件轮到队尾，明确的载荷拒绝保存到本地 quarantine；新 API 协议就绪前保留队列。App 异常由 NAS supervisor 重建，PostgreSQL 连续 3 次 unhealthy 后自动重启；Docker Desktop 不可用时会请求 macOS 启动。所有容器使用 Docker `local` logging driver，单文件上限 20 MB、最多保留 10 个轮转文件。

服务监控在检查 Docker 前，会重新注册已安装但被卸载的 NAS LaunchAgent；显式禁用的任务不会被重新启用。服务监控与报表调度使用系统文件锁，进程退出后自动释放，不再因遗留目录锁永久跳过检查。**未经用户明确、强制要求，绝不能主动停止生产守护进程**，包括通过安装、重载或排障脚本间接停止；受保护任务清单及命令限制统一见 [AGENTS.md](AGENTS.md#生产守护进程保护硬性约束)。

NAS、服务监控、自动部署和报表调度安装器发现任务已加载时会直接退出，不修改 plist 或重启任务；仅为未加载且未显式禁用的任务执行安装和 `bootstrap`，由 `RunAtLoad` 启动。

在实际 Docker 主机执行：

```bash
chmod +x scripts/service-monitor.sh scripts/install-service-monitor.sh
scripts/install-service-monitor.sh
```

状态变化会写入 `$HOME/Library/Logs/fg-studio-service-monitor.log`，匹配到的 App 错误会追加到 `$HOME/Library/Logs/fg-studio-monitor/app-errors.log`。如需主动通知，在 `.env.docker` 配置 `FG_MONITOR_WEBHOOK_URL`，并将 `FG_MONITOR_WEBHOOK_TYPE` 设置为 `generic`、`feishu` 或 `wecom`；未配置 webhook 时不影响自动恢复和本地日志。告警只在健康状态发生变化时发送，恢复后也会发送一次，避免重复轰炸。

服务监控、部署失败和浏览器错误/诊断会通过独立的观测接口写入 PostgreSQL；观测写入走异步有界队列并重试，不阻断正常业务。浏览器端上报受限于 `error`、`unhandledrejection`、网络失败、未成功的 `/api/*` 响应和少量关键诊断事件，服务端会限流并脱敏；长时间数据库故障、浏览器离线或保护性限流仍需从 Docker stdout 恢复。内部接口优先使用 `FG_OBSERVABILITY_SECRET`，未配置时兼容使用 `SESSION_SECRET`；启用 Nginx TLS 后，生产部署脚本和监控默认使用 App 的回环端口 `http://127.0.0.1:3001`。

在实际 Docker 主机安装报表 scheduler（每 5 分钟检查一次到期任务，单轮最多生成 4 份，进程带互斥锁，失败或历史补算会在下一轮继续）并访问管理员页面 `/admin/reports`：

```bash
chmod +x scripts/report-scheduler.sh scripts/install-report-scheduler.sh
scripts/install-report-scheduler.sh
```

日报在次日 00:15 后生成临时版，较早日期会在后续窗口生成最终版；周报在周一生成临时版、周三后结算；月报在次月 1 日生成临时版、次月 3 日后结算。每个周期保留 `revision=0` 临时版和 `revision=1` 最终版，不覆盖旧结果。报表将成本分为供应商确认、价格估算和风险预留，并把未知成本调用单独计数；服务观测不完整时不计算可用率结论。可选配置 `FG_REPORT_WEBHOOK_URL` 和 `FG_REPORT_WEBHOOK_TYPE`（`generic`、`feishu`、`wecom`）接收报表任务结果通知。

报表历史按日报、周报、月报分别读取最近 40 条，避免较早的月报被日报挤出。服务监控会检查报表 LaunchAgent 是否加载；仅对已安装、未显式禁用的缺失任务执行 `bootstrap`，已加载任务保持运行。此检查在 Docker 可用性检查前执行，启动时 Docker 尚未就绪也不会漏掉任务恢复。

媒体访问经过应用鉴权，不能直接公开 NAS 目录。带参考图片/视频/音频调用外部 Wetoken 时，应用会先用 Cloudflare Tunnel 的公网 HTTPS 签名 URL 和生成任务的精确 `model` 创建 WeToken 素材，等待 `GetAsset` 返回 `Active`，再把 `asset://asset-...` 交给 Seedance；上传或确定性提交失败时会尽力清理本次新建素材。`192.168.x.x`、localhost 和需要登录的局域网地址无法被素材库下载。签名媒体 URL 会按 TTL 自动过期。纯文生视频不需要素材库上传。该素材库契约仅适用于 Seedance 视频参考素材，Wetoken 文本视觉输入和图片编辑继续使用各自原生协议。不要把 Cloudflare Tunnel 的 token 提交到 Git。

参考素材确认前会使用 `Range: bytes=0-0` 做公网预检；对 `530`、`5xx` 和网络超时最多重试 3 次。重试后仍不可达时返回 `503 REFERENCES_TEMPORARILY_UNAVAILABLE` 并保留草稿，不进入 Wetoken 素材上传和用量扣除；`401/403/404` 等确定性访问失败则直接返回 `REFERENCES_NOT_REACHABLE`。

## 目录速览

```text
app/                         Next.js 页面和服务端 API
components/                  FG Studio 与创作台组件
lib/                         本地数据库、认证、媒体、AI 适配器、用量账本
reference/infinite-canvas/   超级画布运行时及其适配层
docker/initdb/001-local.sql  PostgreSQL 初始化结构
docker/initdb/002-local-upgrade.sql  已有本地 volume 的幂等升级
docker/initdb/003-local-observability.sql  业务审计事件兼容升级
docker/initdb/004-company-productions.sql  公司视频制片流程结构
docker/initdb/005-observability-reporting.sql  监控事件与周期报表结构
docker/initdb/006-observability-log-stream.sql  结构化服务日志检索流
tests/                       类型、账本、API 和价格测试
```

## 开源许可与来源
