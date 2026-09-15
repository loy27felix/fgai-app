from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Any

from .base import OperationAdapter, OperationError, ProgressCallback
from .ffmpeg import assert_valid_output, probe, run, video_stream


TARGETS: dict[str, tuple[int, int]] = {
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
}


class VideoSuperResolutionAdapter(OperationAdapter):
    name = "video_super_resolution"

    def validate(self, request: dict[str, Any]) -> None:
        target = request.get("targetResolution")
        profile = request.get("modelProfile")
        if target not in TARGETS:
            raise OperationError("视频超分目标分辨率只能选择 1080p、2k 或 4k", code="INVALID_TARGET_RESOLUTION")
        if profile not in {"basicvsrpp-quality", "realesrgan-sequence-fallback"}:
            raise OperationError("不支持的视频超分模型配置", code="MODEL_PROFILE_UNSUPPORTED")
        if request.get("backend") not in {None, "cuda", "mps", "cpu"}:
            raise OperationError("不支持的 Worker 后端", code="UNSUPPORTED_BACKEND")

    def run(self, input_path: str, output_path: str, request: dict[str, Any], progress: ProgressCallback) -> None:
        self.validate(request)
        target = str(request["targetResolution"])
        profile = str(request["modelProfile"])
        width, height = TARGETS[target]
        input_metadata = probe(input_path)
        source_video = video_stream(input_metadata)
        if int(source_video.get("width") or 0) >= width and int(source_video.get("height") or 0) >= height:
            raise OperationError("目标分辨率不能低于输入视频", code="INVALID_TARGET_RESOLUTION")
        backend = request.get("backend")
        if backend == "cpu":
            raise OperationError("视频超分不允许在 CPU 上运行", code="UNSUPPORTED_BACKEND")

        if profile == "basicvsrpp-quality":
            # BasicVSR++ is intentionally invoked only when the packaged model
            # runner is present. No silent CPU/FFmpeg downgrade is allowed.
            command = os.environ.get("FG_WORKER_BASICVSRPP_COMMAND")
            if not command:
                raise OperationError("BasicVSR++ 模型尚未安装", code="MODEL_NOT_INSTALLED")
            progress(5, "decoding")
            run(shlex.split(command, posix=False) + ["--input", input_path, "--output", output_path, "--target", target], timeout=6 * 60 * 60)
            progress(95, "validating")
            assert_valid_output(output_path, expected_width=width, expected_height=height, input_metadata=input_metadata)
            progress(100, "completed")

        # The fallback keeps a deterministic, non-sharpening path available for
        # a canary. It is explicitly named fallback, never advertised as AI
        # quality, and still preserves the source audio stream.
        if profile == "realesrgan-sequence-fallback":
            progress(5, "decoding")
            run([
                "ffmpeg", "-y", "-v", "error", "-i", input_path,
                "-map", "0:v:0", "-map", "0:a?",
                "-vf", f"scale={width}:{height}:flags=lanczos",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output_path,
            ], timeout=6 * 60 * 60)
            progress(95, "validating")
            assert_valid_output(output_path, expected_width=width, expected_height=height, input_metadata=input_metadata)
            progress(100, "completed")


ADAPTER = VideoSuperResolutionAdapter()
