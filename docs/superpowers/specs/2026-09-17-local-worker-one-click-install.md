# 本地 Worker 一键安装规范

## 目标

最终用户不需要安装 Python、FFmpeg、PyTorch、CUDA/MPS 依赖或模型权重。用户从 FG Studio 下载对应平台的安装包，输入一次性配对码，安装器自动完成运行时、模型、配置和后台 Worker 注册。

## 约束

- Mac mini 继续负责 FG Studio、PostgreSQL、WeToken、账单、任务队列和 NAS。
- 安装包只访问 FG Studio 的 HTTPS API；不要求用户挂载 NAS、不接收 WeToken Key、不开放入站端口。
- 安装器只能下载服务端发布清单中的 artifact，并校验 HTTPS、字节数和 SHA-256；不允许任意 URL 或任意压缩包路径。
- 配对码仍然一次性、10 分钟有效；安装器查询清单不会消费配对码，最终注册时才消费。
- 运行时、FFmpeg、模型 Runner 和权重作为发布 artifact 存在 NAS，不进入 Git；服务端未配置发布清单时安装接口返回明确的“暂未发布”错误。
- `MEDIA_WORKER_ENABLED=false` 时安装/Worker API 均关闭，现有 WeToken 和画布生成流程不变。

## 发布清单

服务端环境变量 `FG_WORKER_RELEASE_MANIFEST_PATH` 指向 NAS 上的内部 JSON 文件。清单按平台和架构保存 release：

```json
{
  "schemaVersion": 1,
  "releases": {
    "windows-amd64": {
      "version": "0.1.0",
      "requiredDiskBytes": 10737418240,
      "artifacts": [
        {
          "id": "installer-windows-amd64-0.1.0",
          "kind": "installer",
          "bucket": "creator-assets",
          "path": "worker-releases/0.1.0/FGStudioWorkerSetup.exe",
          "fileName": "FGStudioWorkerSetup.exe",
          "bytes": 120000000,
          "sha256": "64 位小写十六进制摘要"
        },
        {
          "id": "runtime-windows-amd64-0.1.0",
          "kind": "runtime",
          "bucket": "creator-assets",
          "path": "worker-releases/0.1.0/runtime-windows-amd64.zip",
          "fileName": "runtime-windows-amd64.zip",
          "bytes": 420000000,
          "sha256": "64 位小写十六进制摘要"
        }
      ],
      "runnerCommands": {
        "basicvsrpp-quality": "runners/basicvsrpp.exe",
        "realesrgan-sequence-fallback": "runners/realesrgan.exe",
        "propainter-mask": "runners/propainter.exe"
      },
      "ffmpegDir": "ffmpeg"
    }
  }
}
```

返回给安装器的清单会移除 `bucket` 和 `path`，只保留 artifact ID 与服务端下载路径。artifact 下载必须带配对码请求头，服务端先验证配对码再签发 10 分钟的 NAS 读取地址。

## 用户流程

1. 用户在画布右上角点击“生成一次性配对码”和“下载一键安装包”。
2. 用户双击安装包，粘贴配对码；不需要打开终端或理解任何开发依赖。
3. 安装器检测平台/GPU/磁盘，下载并校验运行包和模型包，失败时删除 staging，不碰已有版本。
4. 安装器保存服务端地址到用户配置目录，把 Worker Token 写入系统钥匙串，并自动启动后台 Worker。
5. Worker 只主动 HTTPS 轮询；画布显示在线状态和任务进度。

## 更新和回滚

每个版本使用独立目录。下载完成、哈希校验和 Worker 健康检查通过后，原子切换 `current` 指针；失败保留旧版本。撤销 Worker 只撤销服务端 Token，不删除 NAS 资产。

## 平台策略

- Windows/NVIDIA 使用 CUDA runtime 和已打包的 CUDA Runner；先在 RTX 4060 Ti 机器完成 canary。
- Apple Silicon 使用 MPS Runner；只有实际通过 MPS canary 的模型才写入 macOS release。
- 两个平台共享 API、队列和数据库协议，但每个平台只能领取清单中明确支持的模型配置。
