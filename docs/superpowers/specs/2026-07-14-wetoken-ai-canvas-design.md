# FG Studio Wetoken 多模态生成与画布改造设计

> 日期：2026-07-14  
> 状态：待用户书面复核后进入实现  
> 部署链路：GitHub `loy27felix/fgai-app` → Vercel → Supabase

## 1. 目标

在保留现有 DeepSeek 文本模型的前提下，将其余文本与图片模型从旧中转迁移到 Wetoken，并新增 Seedance 2.0 站内视频生成。所有可用模型由用户在界面自行选择，包括 `filter-off` 变体。

同时把现有资产库、导演分镜表和逐镜头设计中的生图画布扩展为统一的多模态生成画布，形成“参考素材 → 提示词 → 图片 → 视频任务 → 结果入库”的闭环。

本轮不实现视频拼接。BGM 继续由 Suno 外部生成，但 FG Studio 负责按镜头区间生成、保存和复制 Suno Style Prompt。

## 2. 已确认约束

- 继续使用用户已提供的 Wetoken Key，不要求重新生成。
- Key 只能进入 `.env.local`、Vercel Environment Variables 或 Supabase Secrets，不得进入 Git、浏览器包、日志或数据库。
- 保留现有 DeepSeek 两个文本模型及其直连配置。
- 删除旧中转的模型配置、旧 Key 引用和 `api.gpt.ge` 默认地址。
- 普通版和全部 `filter-off` Seedance 模型均接入，选择权交给用户。
- 移除 TapNow、LiblibAI 的主要生成入口，不再把外部网站作为视频工作流主路径。
- 不恢复“视频拼接导出”阶段。
- 每个实施阶段必须独立验证、独立提交并 push 到 `origin/main`。
- 数据库改动只做向后兼容的新增或安全迁移，不破坏现有项目、镜头和资产数据。

## 3. 模型目录

### 3.1 文本与多模态

| 界面名称 | API 模型名 | Provider | 状态 |
|---|---|---|---|
| DeepSeek Flash | 现有配置 | DeepSeek | 保留 |
| DeepSeek Pro | 现有配置 | DeepSeek | 保留 |
| GPT-5.6 Luna | `gpt-5.6-luna` | Wetoken | 接入 |
| GPT-5.6 Terra | `gpt-5.6-terra` | Wetoken | 接入 |
| GPT-5.6 Sol | `gpt-5.6-sol` | Wetoken | 接入 |
| Claude Opus 4.8 | `claude-opus-4-8` | Wetoken | 接入 |

GPT-5.6 与 Claude 首选 Wetoken 的 OpenAI-compatible chat 接口，以复用现有消息、图片和文档上下文结构；如果 Claude 的多图片兼容性实测不满足要求，再在同一 provider 接口内切换为 Anthropic 协议，不改变前端调用方式。

### 3.2 图片

| 界面名称 | API 模型名 | 接口适配 |
|---|---|---|
| GPT Image 2 | `gpt-image-2` | `/v1/images/generations`、`/v1/images/edits` |
| Gemini 3 Pro Image Preview | `gemini-3-pro-image-preview` | Gemini `generateContent` |
| Gemini 3.1 Flash Image Preview | `gemini-3.1-flash-image-preview` | Gemini `generateContent`，先通过 smoke test |
| Gemini 3.1 Flash Lite Image | `gemini-3.1-flash-lite-image` | Gemini/OpenAI 兼容能力先通过 smoke test |

图片适配层统一输出标准结果：`url`、`mimeType`、`width/height`（可得时）、`providerPayload` 摘要。模型不支持的尺寸、参考图数量或参数必须在服务端校验，并返回可读错误，不能静默降级到其他模型。

### 3.3 视频

| 界面名称 | API 模型名 | 标记 |
|---|---|---|
| Seedance 2.0 | `doubao-seedance-2-0` | 标准 |
| Seedance 2.0 Filter Off | `doubao-seedance-2-0-filter-off` | FILTER OFF |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast` | 快速 |
| Seedance 2.0 Fast Filter Off | `doubao-seedance-2-0-fast-filter-off` | 快速 / FILTER OFF |
| Seedance 2.0 Mini | `dreamina-seedance-2-0-mini` | 轻量 |
| Seedance 2.0 Mini Filter Off | `dreamina-seedance-2-0-mini-filter-off` | 轻量 / FILTER OFF |

`filter-off` 模型与普通模型拥有相同的可选择地位，但在下拉框、任务详情和生成记录中显示醒目的 `FILTER OFF` 标签。首次选择时显示简短提醒：它只代表独立模型路由，不代表无条件成功或没有上游限制。提醒不阻止用户继续生成。

## 4. 总体架构

### 4.1 单一 AI 网关

新增仓库内 provider 层：

```text
lib/ai/
  catalog.ts          # 模型注册、能力和界面分组
  errors.ts           # 标准错误
  wetoken-client.ts   # 认证、超时、响应解析
  text.ts             # DeepSeek / Wetoken 文本适配
  image.ts            # GPT Image / Gemini 图片适配
  video.ts            # Seedance 创建与查询任务
```

现有前端不直接接触 Provider URL 或 Key。所有调用必须经过已登录的 Next.js Route Handler，并在服务端再次检查项目成员权限。

### 4.2 Route Handlers

- `POST /api/ai/chat`：保留现有流式文本接口，替换旧中转分支。
- `POST /api/ai/image`：统一无参考图生成、多参考图编辑以及结果入库。
- `POST /api/ai/video`：创建 Seedance 任务并写入本地任务表。
- `GET /api/ai/video/[id]`：查询 Wetoken 状态、同步本地记录、成功后写回输出。

视频请求禁止在单次 Vercel Function 内等待生成结束。前端以退避策略轮询：运行中 4 秒一次，连续失败后逐步增加到 10 秒；完成、失败或过期后停止。

### 4.3 Supabase 职责

- Auth：登录态和项目成员鉴权。
- Postgres：项目业务数据、生成记录、异步任务状态。
- Storage：参考图片、生成图片和需要归档的视频文件。
- 现有 `gen-image` Edge Function 在 Next 图片接口完成迁移并验证后退役；退役前将其源码纳入仓库备份，避免线上不可复现。

## 5. 数据设计

新增 `generation_tasks` 表，使用 RLS 限定项目成员可读、可创建者或编辑角色可写：

| 字段 | 用途 |
|---|---|
| `id` | FG Studio 任务 UUID |
| `project_id` / `shot_id` | 所属项目和可选镜头 |
| `user_id` | 发起用户 |
| `kind` | `image` 或 `video` |
| `provider` / `model` | Provider 与精确模型名 |
| `external_task_id` | Wetoken/Seedance task ID |
| `status` | `queued/running/succeeded/failed/expired` |
| `request` | 清理过敏感信息后的生成参数 JSON |
| `output` | 输出 URL、Storage path、元数据 JSON |
| `error` | 可展示的失败原因，不保存 Key 和完整上游响应头 |
| `created_at/updated_at/completed_at` | 生命周期时间 |

现有 `generations` 继续作为轻量计量记录，避免一次改造同时重写管理后台统计。视频任务成功后写入 `shots.video_url`，并在 `generation_tasks.output` 保留完整结果。

## 6. 画布与工作台

### 6.1 画布节点

在现有 `GenCanvas` 基础上逐步支持：

- 素材/参考图节点
- 提示词节点
- 图片生成节点
- 视频生成节点
- 生成结果节点
- 任务状态、失败重试、取消本地轮询

节点连线决定上下文来源。图片节点可以引用多个素材节点；视频节点可以引用首帧、尾帧、参考图、参考视频和参考音频。提交前显示最终结构化参数，避免隐藏输入。

### 6.2 画布隔离

- 资产库共享画布：`scope=assets, refKey=main`
- 导演分镜共享画布：`scope=board, refKey=main`
- 逐镜头画布：`scope=shots, refKey=<shotId>`

逐镜头画布按 `shotId` 隔离，避免所有镜头共用一个 `main` 图导致素材和任务混杂。旧 `scope=shots, refKey=main` 数据保留，只作为“历史共享画布”入口读取，不删除。

### 6.3 视频工作台

视频页改为站内任务中心：模型选择、镜头筛选、参考素材、参数、队列、状态、预览、重试和写回镜头。移除 TapNow/LiblibAI 快捷跳转；保留现有 `video_url` 数据的只读兼容，防止历史项目丢失。

## 7. BGM Cue Sheet

BGM 不接内部生成 API，继续打开 Suno。新增可保存的 Cue Sheet：

- 集/场景
- 起始镜头与结束镜头
- 叙事情绪、速度、乐器、动态曲线
- Suno Style Prompt
- 可选歌词/纯音乐要求
- 时长建议和转场说明

AI 可以根据故事圣经、场景和镜头自动生成初稿，用户可编辑、复制 prompt、打开 Suno。Cue Sheet 必须持久化，不能只存在浏览器状态。

## 8. 安全与错误处理

- 任何 Route Handler 都先校验登录和项目成员关系，再调用 Wetoken。
- 浏览器永远拿不到 Wetoken Key。
- 对上游设置超时、响应大小限制和统一错误映射。
- 不把完整上游错误、Authorization Header 或用户上传的原始 base64 写入日志。
- 对图片/视频格式、尺寸、时长、参考素材数量在提交前校验。
- 生成失败保留任务与参数，支持修改后重试，不自动重复扣费。
- 收紧 `project-assets` 的公开列举能力；兼容现有公开 URL 的改动单独实施并验证。

## 9. 验证策略

新 provider 和数据转换函数使用测试先行：

- 模型目录包含全部指定模型，且能力和 `filter-off` 标记正确。
- 文本消息能正确映射 DeepSeek/Wetoken 请求。
- GPT Image 与 Gemini 的不同请求结构能正确产生。
- Seedance 首帧/尾帧/参考图/视频/音频能正确映射，非法组合会被拒绝。
- 任务状态转换和终止条件正确。
- 未登录、非项目成员、缺少环境变量时返回明确错误。

每个阶段至少执行 TypeScript 检查、相关测试和生产构建。需要真实调用的 smoke test 使用安全提示词和最小成本参数，明确记录调用了哪个模型，不在日志中输出 Key。

## 10. 提交与推送边界

1. `docs: define Wetoken multimodal migration`：本设计文档。
2. `feat(ai): add Wetoken model catalog and provider clients`：环境变量、模型目录、文本适配。
3. `feat(image): migrate image generation to unified gateway`：四个图片模型、旧 Edge 迁移。
4. `feat(video): add Seedance task persistence and APIs`：数据库迁移、任务 API、全部普通/filter-off 模型。
5. `feat(canvas): add per-shot image-to-video generation nodes`：画布和逐镜头接入。
6. `feat(video-ui): replace external video links with task workspace`：站内视频任务中心。
7. `feat(bgm): add shot-range Suno cue sheets`：分段 BGM prompt。
8. `chore(ui): align landing copy and remove stale export/relay remnants`：首页、README、废弃代码和文案清理。

每一步只有在验证通过后才 commit 和 push。若某一步的真实 Wetoken smoke test失败，保留已通过的模型，失败模型仍可显示为“实验性/暂不可用”，不以静默替换模型的方式掩盖问题。

## 11. 非目标

- 不实现视频拼接、时间线剪辑或最终成片渲染。
- 不接 Suno API，也不代替用户在 Suno 完成音乐生成。
- 不在本轮重做完整权限系统、计费系统或模型余额系统。
- 不升级 Next.js/React 大版本；安全升级另行评估，避免与多模态迁移混在同一提交。
