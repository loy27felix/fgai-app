# FG Studio 本地 GPU Worker

本功能把“视频超分”和“遮罩去水印”的后处理放到用户自己的 Windows/NVIDIA 或 Apple Silicon 电脑上执行。它不替换现有的 Mac mini 职责：Mac mini 继续负责 FG Studio、PostgreSQL、WeToken 调用、账单记录、任务队列和 NAS；本地 Worker 只领取已经入队的后处理任务。

## 数据边界

1. 用户上传的参考图、视频和音频先保存为 `creator-assets` 的 NAS 资产，画布只保存资产 ID/持久化路径；不把浏览器 `blob:`、`data:` URL 当作唯一副本。
2. Worker 通过已登录的 HTTPS API 拉取输入到本机临时目录。Worker 不需要 NAS 账号、WeToken Key，也不开放入站端口。
3. Worker 处理结束后分块上传结果。服务端校验 MIME 签名、字节数和 SHA-256，验证通过才移动到 `creator-assets/<用户>/processing-results/<任务>/` 并创建 `creator_assets` 记录。
4. 原始资产永远不覆盖。画布轮询数据库任务；成功后用同源 NAS 地址创建一个派生节点并连回原节点。供应商临时 URL 只用于现有 WeToken 生成流程，不是本功能的归档来源。

## 安全开关

`MEDIA_WORKER_ENABLED=false` 是默认值。开关为 `false` 时，现有图片/视频生成、WeToken 路由和账单行为不改变，新按钮只显示“本地 Worker 尚未启用”。完成真实机器 canary 后，才在服务端 `.env.docker` 改为 `MEDIA_WORKER_ENABLED=true` 并重启 App。

## 用户安装（不需要 Docker/Node）

Worker 是独立 Python 程序，每台需要处理任务的电脑安装一次。推荐 Python 3.11 或 3.12；必须安装 FFmpeg，并按电脑安装对应 GPU 运行环境。

### Windows + NVIDIA CUDA

1. 安装 NVIDIA 官方驱动、Python 3.11/3.12 和 FFmpeg，并确认 `nvidia-smi`、`ffmpeg -version` 有输出。
2. 在本目录创建环境并安装 Worker：

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -e .
   pip install torch --index-url https://download.pytorch.org/whl/cu124
   fg-worker capabilities
   ```

3. 在 FG Studio 画布右上角点击“生成一次性配对码”，在同一台电脑执行（地址换成实际 FG Studio HTTPS 地址）：

   ```powershell
   fg-worker pair --server https://fg.example.internal --code 配对码 --name "张三 Windows GPU"
   fg-worker run --server https://fg.example.internal
   ```

   Token 只写入系统 Credential Manager/keyring，不写入项目文件、命令历史或日志。配对码 10 分钟后失效且只能使用一次。

### macOS + Apple Silicon（MPS）

1. 安装 Xcode Command Line Tools、Python 3.11/3.12 和 FFmpeg（例如 Homebrew），确认 `ffmpeg -version` 有输出。
2. 创建环境并安装 MPS 版 PyTorch：

   ```bash
   python3.11 -m venv .venv
   source .venv/bin/activate
   python -m pip install --upgrade pip
   pip install -e .
   pip install torch
   fg-worker capabilities
   ```

3. 使用画布中的一次性配对码：

   ```bash
   fg-worker pair --server https://fg.example.internal --code 配对码 --name "李四 MacBook"
   fg-worker run --server https://fg.example.internal
   ```

   MPS 只有在 `capabilities` 明确上报后才会领取任务。某个模型没有 MPS 适配器时会返回 `UNSUPPORTED_BACKEND`，不会偷偷退回长时间 CPU 处理。现有 Mac mini 上的 App、WeToken、NAS 和账单服务不需要移动或重装。

## 画布使用

1. 等视频节点的“保存到云端”完成；没有 `cloudAssetId` 的临时节点不能提交。
2. 视频节点工具栏选择“超分 / 去水印”。超分可选 1080p、2K、4K；模型配置会显示 BasicVSR++ 质量模式或不锐化的序列回退模式。
3. 去水印只接受用户在预览图上绘制的遮罩。遮罩也会先保存为独立 NAS 资产；原视频保留。
4. 提交后节点显示“等待本机 Worker / 本机 GPU 处理中 / 正在把结果写回 NAS”。关闭浏览器不取消任务；重新打开画布会按任务 ID继续轮询。
5. 结果是旁边的新派生节点。源节点不会被覆盖，失败只标记源节点错误并保留输入，可从任务状态重试。

## 运维与撤销

- 画布右上角显示 Worker 在线/离线、平台、架构、后端和最近心跳。超过 90 秒没有心跳会标记离线。
- 管理员撤销 Worker 后，旧 Token 立即失效；用户需要重新生成配对码并执行 `pair`。不要复制或保存服务端数据库中的 token hash。
- Worker 只允许出站访问 FG Studio HTTPS。不要为了 Worker 把 NAS SMB 端口或 App 管理端口暴露到公网。
- 睡眠、关机、网络断开或 Worker 被杀掉不会删除源资产。租约 120 秒过期后任务重新排队，最多 3 次；第三次记录 `WORKER_LEASE_EXPIRED` 并标记失败。
- 处理输出在归档前必须通过 SHA-256 和容器/MIME 校验；失败只删除临时上传，不删除源文件。
- 通过 `/admin/logs` 检索 `media_worker_online`、`media_worker_offline`、`media_job_queued`、`media_job_claimed`、`media_job_progress`、`media_job_retryable`、`media_job_upload_verified` 和 `media_job_failed`。日志不记录 token、提示词、签名 URL、本地路径或媒体内容。

## 模型和 benchmark

Git 只保留 `worker/src/fg_worker/models/manifest.json` 的模型名称、后端、内存要求和校验位字段；模型权重不进仓库。安装实际模型 runner 后，通过环境变量 `FG_WORKER_BASICVSRPP_COMMAND`、`FG_WORKER_REALESRGAN_COMMAND` 或 `FG_WORKER_PROPAINTER_COMMAND` 指向本机 runner。只有配置了对应 runner 的能力才会向服务端上报，避免任务领取后才发现模型不存在。runner 必须接收显式 `--input/--output`（去水印另有 `--mask`）参数，并写出新的文件；不会偷偷降级成普通 FFmpeg 放大。

在启用服务端开关前，每台机器至少记录一次 10 秒 480p → 1080p 的实际 benchmark：后端、模型、耗时、峰值内存、输出宽高、帧数、音频是否保留和 SHA-256。没有实测数据的模型配置保持不可领取；不能把“CPU 能运行”当成 GPU canary 通过。

## 两机 canary 签核（当前未执行）

- [ ] Windows/NVIDIA 配对、心跳、领取 10 秒样片、上传校验通过。
- [ ] Apple Silicon/MPS 配对、心跳和至少一个已支持模型通过；不支持的模型保持禁用。
- [ ] 处理过程中关闭浏览器、杀掉 Worker、重新启动，任务重新排队且源资产仍在 NAS。
- [ ] 输出结果在 NAS，数据库中有 `output_asset_id`、字节数、SHA-256 和 FFprobe 元数据；画布刷新后仍能打开派生节点。
- [ ] 去水印遮罩和原视频均可找到；结果不是覆盖写入。
- [ ] 复核一次普通 WeToken 生图/生视频，Reference ID、现有 Mac mini 路由、账单和费用归属不变。
- [ ] 两台机器签核后才把 `MEDIA_WORKER_ENABLED` 改成 `true`；在此之前保持 `false`。
