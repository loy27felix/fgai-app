# Windows NVIDIA Worker

安装 Python 3.11/3.12、NVIDIA 驱动、FFmpeg 后，在仓库 `worker` 目录执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
pip install torch --index-url https://download.pytorch.org/whl/cu124
fg-worker capabilities
```

安装并验证模型 runner 后，再设置 `FG_WORKER_BASICVSRPP_COMMAND`、
`FG_WORKER_REALESRGAN_COMMAND` 或 `FG_WORKER_PROPAINTER_COMMAND`。没有对应
runner 时该能力不会上报，也不会领取任务。

在 FG Studio 生成一次性配对码后：

```powershell
fg-worker pair --server https://fg.example.internal --code 配对码 --name "Windows GPU"
fg-worker run --server https://fg.example.internal
```

首次上线前运行 `fg-worker capabilities` 保存输出，并完成 `docs/local-media-worker.md` 的 canary 清单。不要把 keyring 中的 token 导出到脚本或提交到 Git。
