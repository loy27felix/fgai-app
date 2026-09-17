# FG Studio Worker：Windows/NVIDIA 发布说明

这是维护者发布文档，不是用户安装教程。最终用户只下载
`FGStudioWorkerSetup.exe`、双击运行并粘贴画布的一次性配对码；安装包会自带
Worker runtime、FFmpeg、CUDA Runner 和已审核的模型权重，不要求用户安装
Python、PyTorch、FFmpeg 或命令行工具。

## 维护者构建

构建机需要 Python、PyInstaller、NVIDIA/CUDA Runner 和 FFmpeg 文件。模型权重
必须放在 Runner 目录或 Runner 明确引用的目录，不能提交到 Git。脚本会根据实际
存在的 Runner 生成能力清单，不会为尚未打包的模型伪造入口；因此可以先只发布
已经通过验收的 Real-ESRGAN：

```powershell
.\build-release.ps1 `
  -Version 0.1.0 `
  -RunnerDir D:\approved-runners\windows-amd64 `
  -FfmpegDir D:\approved-runners\ffmpeg `
  -ServerUrl https://fg.example.internal
```

官方 NCNN 便携包可直接放入 Runner 目录，文件名为
`realesrgan-ncnn-vulkan.exe`，并保留同目录的 `models/`、运行库 DLL 和
`realesr-animevideov3-x2/x3/x4` 权重。最终用户不需要安装 Vulkan、CUDA、Python
或 PyTorch；Worker 会把视频解码成帧，调用这个 GPU 二进制，再把原音频封装回
输出视频。

脚本生成 setup、runtime ZIP 和带 SHA-256/字节数的 manifest。将 artifact 上传
到 manifest 中的 NAS 路径后，再把完整 manifest 放到 NAS，并在 App 容器设置：

```env
MEDIA_WORKER_ENABLED=false
FG_WORKER_RELEASE_MANIFEST_PATH=/data/media/worker-releases/manifest.json
```

只有完成 RTX 4060 Ti 的 480p→1080p、断网重试、Worker 重启和输出归档 canary
后，才把开关改为 `true`。发布新版本时使用独立版本目录；下载或健康检查失败
不会替换用户已经可用的版本。撤销仍在 FG Studio 管理端完成，旧 token 会立即
失效。
