from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Any

from .base import OperationAdapter, OperationError, ProgressCallback


class WatermarkRemovalAdapter(OperationAdapter):
    name = "watermark_removal"

    def validate(self, request: dict[str, Any]) -> None:
        if request.get("modelProfile") != "propainter-mask":
            raise OperationError("不支持的去水印模型配置", code="MODEL_PROFILE_UNSUPPORTED")
        mask_path = request.get("maskPath")
        if not isinstance(mask_path, str) or not mask_path.strip():
            raise OperationError("去水印必须提供用户绘制的遮罩", code="MASK_REQUIRED")
        mask = Path(mask_path)
        if not mask.is_file():
            raise OperationError("遮罩文件不存在", code="MASK_NOT_FOUND")
        if request.get("backend") == "cpu":
            raise OperationError("去水印不允许在 CPU 上运行", code="UNSUPPORTED_BACKEND")

    def run(self, input_path: str, output_path: str, request: dict[str, Any], progress: ProgressCallback) -> None:
        self.validate(request)
        command = os.environ.get("FG_WORKER_PROPAINTER_COMMAND")
        if not command:
            raise OperationError("ProPainter 模型尚未安装", code="MODEL_NOT_INSTALLED")
        # The packaged runner receives explicit paths as positional arguments;
        # it must write a new output and never mutate the original input.
        progress(5, "preparing")
        args = shlex.split(command, posix=False) + ["--input", input_path, "--mask", str(request["maskPath"]), "--output", output_path]
        from .ffmpeg import run

        run(args, timeout=6 * 60 * 60)
        if not Path(output_path).is_file() or Path(output_path).stat().st_size <= 0:
            raise OperationError("去水印没有产生输出文件", code="OUTPUT_MISSING")
        progress(100, "completed")


ADAPTER = WatermarkRemovalAdapter()

