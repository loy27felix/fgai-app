# 本地媒体处理 Worker 规格

## 目标

在不改变现有 Mac mini 服务职责、不使用公有云 GPU 的前提下，把视频超分、去水印等后处理能力放到用户自己电脑上的本地 GPU 执行。Mac mini 继续负责现有的网页、鉴权、PostgreSQL、WeToken 调用、费用记录、队列协调和 NAS 持久化。

## 不可改变的现有边界

1. `docker-compose.yml` 中的 App、PostgreSQL、Nginx 和 Cloudflare Tunnel 继续运行在 Mac mini 上。
2. WeToken/Seedance 的调用、API Key、Reference ID 和费用记录继续由 Mac mini 服务端处理；密钥不能下发到用户电脑。
3. 用户上传的参考图、供应商结果和后处理结果以 NAS/`creator-assets` 为唯一持久化来源；浏览器缓存、IndexedDB 和临时供应商 URL 不能作为正式存储。
4. 本地 Worker 不监听公网端口，只通过 HTTPS 主动轮询 Mac mini 的 Worker API。
5. 没有 Worker、Worker 离线或电脑休眠时，任务必须保持排队/可重试，不能被标记为成功、静默删除或把画布节点改成不存在。

## v1 范围

### 支持的本地操作

- `video_super_resolution`：视频超分，首个质量档支持 480p/720p 到 1080p；输出尺寸可由用户选择，保留原帧率、音频和时长。
- `watermark_removal`：视频或图片去水印；v1 要求用户在画布中提供矩形/多边形遮罩，避免自动识别错误导致内容被误删。
- 操作注册表保留 `audio_separation`、`subtitle_removal`、`subject_removal` 扩展位，但本次不要求交付这些模型。

### 支持的本地环境

- Windows x64 + NVIDIA CUDA：v1 首选后端。
- macOS arm64 + Apple Silicon MPS：v1 支持，但安装时必须做能力探测和样片基准测试；不兼容算子允许显式回退 CPU，不能伪装成 GPU 高速执行。
- CPU：仅允许 FFmpeg 转码、抽帧和音频等轻任务；视频超分和去水印在能力不足时必须明确提示。

### 任务和资产

- 任务使用服务端生成的 `job_id`、`idempotency_key`、输入 `asset_id` 和输出 `asset_id`，不接受 Worker 提交的任意 NAS 绝对路径。
- 状态为 `queued → leased → processing → uploading → succeeded`，异常进入 `retryable` 或 `failed`；取消进入 `cancelled`。
- Worker 租约默认 120 秒，心跳间隔 20 秒；租约过期自动回到 `queued`，最多自动重试 3 次。
- 结果先上传到 NAS 临时对象，服务端校验大小、SHA-256、MIME、媒体时长/尺寸后才创建 `creator_assets` 正式记录并把任务标记为 `succeeded`。
- 后处理默认生成新的派生节点，原视频/图片保持不变；节点 metadata 保存来源节点、操作、模型版本和任务 ID。

## Worker 配对和权限

1. 用户在网页生成一次性配对码，配对码有效期 10 分钟且只能消费一次。
2. Worker 用配对码注册机器并上报 OS、架构、GPU、显存、后端、模型版本和 FFmpeg 版本。
3. 服务端只保存 Worker 长期令牌的哈希值；明文令牌只在注册响应中返回一次，Worker 保存到 Windows Credential Manager 或 macOS Keychain。
4. Worker 只能领取所属用户的任务，输入下载和结果上传均由服务端根据 `job_id` 解析，禁止路径穿越和跨用户访问。
5. 用户可以在网页撤销某台 Worker；撤销后现有租约等待超时，未完成任务自动重新排队。

## 服务端接口契约

用户会话接口：

- `GET /api/creator/workers`：列出当前用户 Worker 和最近心跳。
- `POST /api/creator/workers/pairing`：创建一次性配对码。
- `DELETE /api/creator/workers/:id`：撤销 Worker。
- `POST /api/creator/media/jobs`：创建后处理任务。
- `GET /api/creator/media/jobs`：读取当前用户任务及进度。

Worker 令牌接口：

- `POST /api/creator/worker/register`：消费配对码并注册 Worker。
- `POST /api/creator/worker/heartbeat`：刷新能力和在线状态。
- `POST /api/creator/worker/jobs/claim`：原子领取一条可执行任务。
- `POST /api/creator/worker/jobs/:id/progress`：上报阶段、百分比和当前帧。
- `POST /api/creator/worker/jobs/:id/heartbeat`：延长租约。
- `POST /api/creator/worker/jobs/:id/fail`：提交脱敏错误和是否可重试。
- `POST /api/creator/worker/jobs/:id/output/init`、`PATCH /api/creator/worker/uploads/:id`、`POST /api/creator/worker/uploads/:id/complete`：可断点续传结果并完成资产登记。
- `GET /api/creator/worker/jobs/:id/input`：以 Range 流式读取服务端指定的输入资产。

## Mac mini 风险控制

- Mac mini 仍是控制面单点，但媒体和数据库备份放在 NAS；现有 Docker/NAS supervisor、健康检查和自动部署继续使用。
- 新 Worker 接口不能依赖浏览器长连接；页面刷新不影响任务。
- Worker 只能主动出站连接，不能要求用户开放端口或共享 SMB。
- 功能使用独立 feature flag；关闭 Worker 功能不会影响现有生图、生视频和账单流程。

## 质量和验收

1. 相同输入、相同模型版本和参数在 Worker 上可重试且结果哈希一致，或明确记录非确定性模型版本。
2. 超分输出分辨率、帧率、音轨和时长通过 FFprobe 校验；默认不额外锐化。
3. 去水印任务显示遮罩预览，原文件不可变，输出作为新资产。
4. 浏览器关闭、Worker 进程被杀、NAS 短暂不可用、上传中断和服务重启后，任务均能恢复或显示可操作错误。
5. Worker 离线时 UI 显示“等待本机 Worker”，而不是“生成失败”。
6. 仅允许本地 Worker 路径，代码和配置中不存在公有云 GPU fallback。

## 分阶段交付

- 阶段 A：数据库、鉴权、租约队列、资产上传协议和 Worker 状态页，不接模型。
- 阶段 B：Windows NVIDIA Worker + 视频超分样片基准测试。
- 阶段 C：macOS Apple Silicon MPS Worker + 兼容性基准测试。
- 阶段 D：去水印遮罩 UI 和模型适配器。
- 阶段 E：两名内部用户灰度，完成失败恢复、NAS 备份和回滚演练后再开放全员。
