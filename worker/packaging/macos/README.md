# FG Studio Worker：Apple Silicon 发布说明

这是维护者发布文档。最终用户不安装 Python、PyTorch、FFmpeg、MPS 依赖或模型
权重，只下载对应的 `FGStudioWorkerSetup` 安装包、双击并粘贴一次性配对码。

维护者在 Apple Silicon 构建机准备已经通过 MPS canary 的 Runner 和 FFmpeg，执行：

```bash
FG_STUDIO_SERVER_URL=https://fg.example.internal \
  ./build-release.sh 0.1.0 /Volumes/approved-runners/macos-arm64 /Volumes/approved-runners/ffmpeg
```

把生成的 setup/runtime artifact 按 manifest 上传到 NAS，manifest 路径通过
`FG_WORKER_RELEASE_MANIFEST_PATH` 提供给 App。没有实际通过 MPS canary 的模型
不要写入 macos-arm64 的 `runnerCommands`，避免 Worker 领取后才失败。Mac mini
继续运行 FG Studio、数据库、WeToken、队列和 NAS，不会被这个用户 Worker 安装
替换。
