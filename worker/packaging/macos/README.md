# macOS Apple Silicon Worker

在 Apple Silicon Mac 上安装 Python 3.11/3.12、FFmpeg 和当前 PyTorch MPS 支持，然后在仓库 `worker` 目录执行：

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
pip install torch
fg-worker capabilities
```

安装并验证 MPS 模型 runner 后，再设置对应的
`FG_WORKER_BASICVSRPP_COMMAND`、`FG_WORKER_REALESRGAN_COMMAND` 或
`FG_WORKER_PROPAINTER_COMMAND`。没有 runner 的能力不会上报，避免领取后才
失败。

生成一次性配对码后运行：

```bash
fg-worker pair --server https://fg.example.internal --code 配对码 --name "Apple Silicon GPU"
fg-worker run --server https://fg.example.internal
```

`capabilities` 没有上报 `mps` 时不会领取 GPU 任务。BasicVSR++/ProPainter 的 MPS runner 通过 canary 验证后才能启用；现有 Mac mini 的 FG Studio、WeToken、PostgreSQL、NAS 和费用功能不受这个 Worker 安装影响。
