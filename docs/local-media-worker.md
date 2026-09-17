# FG Studio 本地 GPU Worker

本功能把“视频超分”和“遮罩去水印”的后处理放到用户自己的 Windows/NVIDIA
或 Apple Silicon 电脑上执行。Mac mini 的职责不变：它继续运行 FG Studio、
PostgreSQL、WeToken 调用、费用账本、任务队列和 NAS；本地 Worker 只领取已入队
的后处理任务。

## 用户不需要安装任何开发依赖

最终用户只做两件事：

1. 在画布右上角点击“下载一键安装包”，再点击“生成一次性配对码”。
2. 双击安装包，把配对码粘贴进去并确认。

安装包自己携带 Python runtime、FFmpeg、CUDA/MPS Runner、BasicVSR++、
Real-ESRGAN、ProPainter 及已经审核的模型权重。用户不需要知道 Python、
FFmpeg、PyTorch、CUDA、模型路径，也不需要打开终端；安装程序会检测 GPU 和
磁盘、下载对应平台的运行包、校验 SHA-256、写入系统钥匙串并启动后台 Worker。
安装失败只清理 staging，不覆盖此前可用版本。

当前下载按钮只显示已发布的平台：Windows 浏览器下载 `windows-amd64`，
macOS 浏览器下载 `macos-arm64`。如果管理员还没有发布清单，界面会显示“暂未
发布”，不会让用户安装一个缺少模型的空包。

## 数据边界

1. 用户上传的参考图、视频和音频先保存为 `creator-assets` 的 NAS 资产，画布只保存资产 ID/持久化路径；不把浏览器 `blob:`、`data:` URL 当作唯一副本。
2. Worker 通过已登录的 HTTPS API 拉取输入到本机临时目录。Worker 不需要 NAS 账号、WeToken Key，也不开放入站端口。
3. Worker 处理结束后分块上传结果。服务端校验 MIME 签名、字节数和 SHA-256，验证通过才移动到 `creator-assets/<用户>/processing-results/<任务>/` 并创建 `creator_assets` 记录。
4. 原始资产永远不覆盖。画布轮询数据库任务；成功后用同源 NAS 地址创建一个派生节点并连回原节点。供应商临时 URL 只用于现有 WeToken 生成流程，不是本功能的归档来源。

## 安全开关

`MEDIA_WORKER_ENABLED=false` 是默认值。开关为 `false` 时，现有图片/视频生成、
WeToken 路由和账单行为不改变，新按钮只显示“本地 Worker 尚未启用”。完成真实
机器 canary 后，才在服务端 `.env.docker` 改为 `MEDIA_WORKER_ENABLED=true` 并重启 App。

服务端通过 `FG_WORKER_RELEASE_MANIFEST_PATH` 读取 NAS 上的内部发布清单。返回给
安装器的清单会移除 NAS bucket/path，只提供 artifact ID、版本、字节数、SHA-256
和同源下载路径；每次下载都要带一次性配对码，服务端先验证未消费且未过期的
配对码，再签发 10 分钟 NAS 读取地址。配对码仍是 10 分钟、一次性；Worker
Token 只写系统 Credential Manager/Keychain，不写配置文件或日志。

## 画布使用

1. 等视频节点的“保存到云端”完成；没有 `cloudAssetId` 的临时节点不能提交。
2. 视频节点工具栏选择“超分 / 去水印”。超分可选 1080p、2K、4K；模型配置会显示 BasicVSR++ 质量模式或不锐化的序列回退模式。
3. 去水印只接受用户在预览图上绘制的遮罩。遮罩也会先保存为独立 NAS 资产；原视频保留。
4. 提交后节点显示“等待本机 Worker / 本机 GPU 处理中 / 正在把结果写回 NAS”。关闭浏览器不取消任务；重新打开画布会按任务 ID 继续轮询。
5. 结果是旁边的新派生节点。源节点不会被覆盖，失败只标记任务错误并保留输入，可从任务状态重试。

## 运维与撤销

- 画布右上角显示 Worker 在线/离线、平台、架构、后端和最近心跳。超过 90 秒没有心跳会标记离线。
- 管理员撤销 Worker 后，旧 Token 立即失效；用户需要重新生成配对码并重新运行安装包。不要复制或保存服务端数据库中的 token hash。
- Worker 只允许出站访问 FG Studio HTTPS。不要为了 Worker 把 NAS SMB 端口或 App 管理端口暴露到公网。
- 睡眠、关机、网络断开或 Worker 被杀掉不会删除源资产。租约 120 秒过期后任务重新排队，最多 3 次；第三次记录 `WORKER_LEASE_EXPIRED` 并标记失败。
- 处理输出在归档前必须通过 SHA-256 和容器/MIME 校验；失败只删除临时上传，不删除源文件。
- 通过 `/admin/logs` 检索 `media_worker_online`、`media_worker_offline`、`media_job_queued`、`media_job_claimed`、`media_job_progress`、`media_job_retryable`、`media_job_upload_verified` 和 `media_job_failed`。日志不记录 token、提示词、签名 URL、本地路径或媒体内容。

## 发布与回滚（维护者）

维护者在 Windows RTX 4060 Ti 机器或 Apple Silicon 构建机准备 Runner/FFmpeg，
使用 `worker/packaging/windows/build-release.ps1` 或
`worker/packaging/macos/build-release.sh` 生成 setup、runtime ZIP 和 manifest。
模型权重不进入 Git；artifact 上传到 NAS 后才把清单配置给 App。每个平台的
`runnerCommands` 只列入已经通过真实 canary 的模型。新版本使用独立目录；安装
包下载、哈希校验或 Worker 健康检查失败时保留旧版本，撤销只撤销服务端 Token。

## RTX 4060 Ti 首轮 canary

在当前 NVIDIA 电脑执行 `worker/packaging/windows/preflight.ps1`。它只读取
`nvidia-smi`、FFmpeg、磁盘和本地 Worker 配置，不上传任何媒体。必须看到 RTX
4060 Ti、可用显存、FFmpeg 和至少一个已安装 Runner，脚本才返回成功。随后完成：

- [ ] 配对、心跳、领取 10 秒 480p→1080p 样片、上传校验通过。
- [ ] 处理过程中关闭浏览器、杀掉 Worker、重新启动，任务重新排队且源资产仍在 NAS。
- [ ] 输出在 NAS，数据库有 `output_asset_id`、字节数、SHA-256 和 FFprobe 元数据；刷新画布仍能打开派生节点。
- [ ] 去水印遮罩和原视频均可找到；结果不是覆盖写入。
- [ ] 复核一次普通 WeToken 生图/生视频，Reference ID、Mac mini 路由、账单和费用归属不变。

没有完成这些签核前，保持 `MEDIA_WORKER_ENABLED=false`，不要把空 Runner 或仅能
CPU 放大的配置发布给用户。
