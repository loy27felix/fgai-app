# 参考项目与 Agent 适配记录 · 2026-09-23

这轮逐项重看五个指定仓库，并复核 OiiOii、TapNow、LibTV 的产品流程。第六板块继续保持独立；只采用能与现有 Next.js / TypeScript 数据层直接结合的部分，不把不兼容的整套服务和旧 Agent 搬进来。

| 参考 | 实际可借鉴点 | 本地采用方式 |
| --- | --- | --- |
| [Huobao Canvas](https://github.com/chatfire-AI/huobao-canvas) | 强类型节点、连线前校验、上游结果注入下游提示、撤销重做、自动排布，以及服务端异步任务与画布共用持久化 | 节点和连线结构已用于第六板块；Agent 现在读取服务端图、选中节点和上游文字链。Huobao 的 Vue Flow 与 11 家媒体服务适配器不直接挂载到 Next 应用；新媒体队列仍待接入 |
| [Infinite Canvas](https://github.com/tigerowo/infinite-canvas) | Agent 明确读取画布/选中节点/Skill，并通过受限工具创建、改写和连接节点；媒体任务与会话分开处理 | 采用“画布上下文 + 精选 Skill + 类型化操作 + 用户确认”的边界；第六板块不复用旧 Agent 的工具循环。当前只有文字 Agent 和画布草案操作 |
| [Open AI Canvas](https://github.com/ddcat-ai/open-ai-canvas) | 画布工作区覆盖多媒体节点、素材、任务、主题切换；主题持久化与恢复需独立存储 | 主题存储适配器位于 `lib/production-lab/use-lab-theme.ts`，只读写 `fg-production-lab-appearance-v1`。按该项目的 canvas/task/media 组合方式核对新板块模块边界 |
| [TapCanvas](https://github.com/anymouschina/TapCanvas) | Agent Bridge、能力清单、结构化图补丁、运行版本基准；DAG 画布自动布局 | 直接复用 `workflowFlowLayout.ts` 中的纯 DAG 排布算法，来源为仓库 commit `4e7af838fc474879b0a2bb5230a7787c26c8ef97`。新板块后端另做项目授权、图版本 CAS 和输入校验 |
| [AID Studio](https://github.com/gzxx-2025/aid-studio) | 剧本、人物场景、分镜、图像/视频/配音围绕同一项目；模型与运行记录由管理端配置 | 用它校验“推进管理—创作—制作—交付”的对象关联，以及管理端应该看真实任务。其 Java 运行栈不适合作为现有 Next 项目的直接组件 |

源码适配范围：TapCanvas 的纯排布算法被直接采用；Open AI Canvas 的主题 store 行为做了小型适配。相应上游 LICENSE 原文保存在 `lib/production-lab/vendor/`。其他仓库采用功能模式与结构参考，没有复制整套应用。

## 对产品 Agent 的取舍

- OiiOii 展示了把角色、场景与镜头统一到连续性图谱里的好处。FG 采用一套项目/分集/画布事实源；按用户的要求只保留一个“编导”工作台，不再造重复的编剧 Agent 与导演 Agent。
- TapNow 的“读明确上下文 → 确认交付物和限制 → 说明计划与确认点 → 执行 → 局部修订 → 检查交付”适合制作 Agent。第六板块做了动态问答、选项、制作 Skill、操作预览和明确的应用按钮。
- LibTV 的产品站把剧本、导演、角色造型、图片/视频/音频等放在同一制作入口。本地 `libtv-video-producer` 只作为方法资料；当前适配的是项目化分工，不是登录或远程控制 LibTV。
- 选择 Skill 限于漫剧编导、美术与制作。Skill 正文仅在服务端读入；每轮最多两个；未部署运行器的 Skill 不会展示成可执行能力。

## 当前实现与真实边界

- 项目推进与制作画布按项目 ID、分集号关联。新库中的画布图存储有独立表，使用 `expectedVersion` 比较并交换；冲突时提供下载本机副本或载入服务器版本。
- 剧本工作台支持多个文本模型并行比较；采用的版本带模型/来源/请求 ID，回写项目分集任务与对应分集画布。批次运行记录写入独立数据库；前端页面负责调度，尚不是可关页继续工作的 Worker。
- 制作 Agent 通过服务端模型读取项目、分集、完整画布节点索引及选中节点的上游文字依据。它可以追问并返回新增节点或修改选中节点的类型化草案；用户确认后才写入同一画布。
- 本地媒体素材仍在各用户浏览器的项目草稿库中，素材图片/音视频二进制尚未上传到服务端，模型无法看到其图像内容。官方库共享发布、故事资产团队可见与审核尚未接通。
- **真实图片 / 视频 / 音频生成、后台任务队列、模型成本对账、取消与续跑没有接入。**Agent 当前能整理视频提示词并建立视频任务节点，不能生成成片或声称扣费成功。
- GPU 超分、去水印与旧画布生产数据迁移仍延期。已有超级画布和 Mac mini 上的服务不在本次修改范围。

## 独立配置与数据库迁移

第六板块模型仅由服务端 `PRODUCTION_LAB_TEXT_MODELS` 提供，字段为 `id,label,model,endpoint,apiKey`；密钥不回传浏览器，endpoint 要求 HTTPS OpenAI-compatible Chat Completions。Claude 需通过兼容网关，不是原生 Anthropic 协议适配。

独立测试数据库按顺序使用：`001.sql` 项目状态、`002-script-runs.sql` 批次运行记录、`003-script-run-project-scope.sql` 项目/分集绑定、`004-project-canvas-graphs.sql` 项目画布。**当前没有对 Mac mini 或任意线上数据库执行迁移。**部署时必须使用新库，并由部署者核验库身份；不可使用旧 `DATABASE_URL`。
