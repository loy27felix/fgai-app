from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .base import OperationAdapter, OperationError, ProgressCallback
from .ffmpeg import assert_valid_output, executable, probe, run, video_stream
from ..runtime_config import runner_args, runtime_environment


TARGETS: dict[str, tuple[int, int]] = {
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
}


def _frame_rate(value: Any) -> float:
    """Parse an ffprobe frame-rate field and keep it in a sane range."""

    try:
        text = str(value or "").strip()
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            rate = float(numerator) / float(denominator)
        else:
            rate = float(text)
    except (TypeError, ValueError, ZeroDivisionError):
        rate = 30.0
    if not math.isfinite(rate):
        rate = 30.0
    return min(120.0, max(1.0, rate))


def _portable_scale(source_video: dict[str, Any], width: int, height: int) -> int:
    """Choose the smallest native Real-ESRGAN scale that reaches the target."""

    source_width = max(1, int(source_video.get("width") or 1))
    source_height = max(1, int(source_video.get("height") or 1))
    required = max(width / source_width, height / source_height)
    for scale in (2, 3, 4):
        if required <= scale:
            return scale
    # The portable model cannot natively exceed x4.  The final FFmpeg pass
    # still produces the explicitly requested dimensions, but never silently
    # downgrades the job to a plain resize.
    return 4


def _portable_model_path(command: list[str], scale: int) -> Path:
    """Find the model files shipped beside the portable NCNN executable."""

    if not command:
        raise OperationError("Real-ESRGAN 模型尚未安装", code="MODEL_NOT_INSTALLED")
    executable_path = Path(command[0]).expanduser()
    if not executable_path.is_absolute():
        executable_path = Path(shutil.which(str(executable_path)) or executable_path)
    executable_path = executable_path.resolve()
    roots = (executable_path.parent / "models", executable_path.parent.parent / "models")
    model_name = f"realesr-animevideov3-x{scale}.param"
    for root in roots:
        if (root / model_name).is_file() and (root / model_name.replace(".param", ".bin")).is_file():
            return root
    raise OperationError("Real-ESRGAN 模型权重不完整，请重新运行 FG Studio Worker 安装", code="MODEL_NOT_INSTALLED")


def _run_portable_command(command: list[str], *, timeout: float) -> None:
    """Run the bundled model binary without exposing a shell to user input."""

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=runtime_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise OperationError(f"Real-ESRGAN 运行失败：{error}", code="MODEL_RUNNER_FAILED", retryable=True) from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()[-1:]
        raise OperationError(
            "Real-ESRGAN 运行失败" + (f"：{detail[0][:300]}" if detail else ""),
            code="MODEL_RUNNER_FAILED",
            retryable=True,
        )


def _run_portable_realesrgan_video(
    input_path: str,
    output_path: str,
    command: list[str],
    source_video: dict[str, Any],
    width: int,
    height: int,
    progress: ProgressCallback,
) -> None:
    """Run the official Real-ESRGAN NCNN binary over a video frame sequence.

    The upstream portable executable intentionally accepts images/directories,
    not a video container.  We therefore decode frames with the bundled
    FFmpeg, process the sequence on the local GPU, then encode the frames back
    while remuxing the original audio stream.
    """

    scale = _portable_scale(source_video, width, height)
    model_root = _portable_model_path(command, scale)
    ffmpeg = executable("ffmpeg")
    fps = _frame_rate(source_video.get("avg_frame_rate") or source_video.get("r_frame_rate"))
    with tempfile.TemporaryDirectory(prefix="fg-worker-realesrgan-") as directory:
        root = Path(directory)
        input_frames = root / "input"
        output_frames = root / "output"
        input_frames.mkdir()
        output_frames.mkdir()

        progress(5, "extracting")
        run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                input_path,
                "-map",
                "0:v:0",
                "-vsync",
                "0",
                str(input_frames / "%08d.png"),
            ],
            timeout=6 * 60 * 60,
        )
        if not any(input_frames.glob("*.png")):
            raise OperationError("视频没有可处理的画面帧", code="VIDEO_FRAMES_MISSING")

        progress(20, "upscaling")
        _run_portable_command(
            command
            + [
                "-i",
                str(input_frames),
                "-o",
                str(output_frames),
                "-n",
                "realesr-animevideov3",
                "-s",
                str(scale),
                "-t",
                "0",
                "-m",
                str(model_root),
                "-f",
                "png",
            ],
            timeout=6 * 60 * 60,
        )
        if not any(output_frames.glob("*.png")):
            raise OperationError("Real-ESRGAN 没有产生画面帧", code="MODEL_OUTPUT_MISSING", retryable=True)

        progress(80, "encoding")
        # WorkerLoop uses a .bin temporary name for every operation.  Explicit
        # -f mp4 keeps the output self-describing without changing that queue
        # contract; the original audio is copied when one exists.
        run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                f"{fps:.6f}",
                "-i",
                str(output_frames / "%08d.png"),
                "-i",
                input_path,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0?",
                "-vf",
                f"scale={width}:{height}:flags=lanczos",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "copy",
                "-shortest",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                output_path,
            ],
            timeout=6 * 60 * 60,
        )


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
            command = runner_args("basicvsrpp-quality")
            if not command:
                raise OperationError("BasicVSR++ 模型尚未安装", code="MODEL_NOT_INSTALLED")
            progress(5, "decoding")
            run(command + ["--input", input_path, "--output", output_path, "--target", target], timeout=6 * 60 * 60)
            progress(95, "validating")
            assert_valid_output(output_path, expected_width=width, expected_height=height, input_metadata=input_metadata)
            progress(100, "completed")

        # The sequence fallback is still an explicit GPU runner contract. Do
        # not silently substitute FFmpeg scaling: that would look like a
        # successful super-resolution job while providing the wrong quality.
        if profile == "realesrgan-sequence-fallback":
            command = runner_args("realesrgan-sequence-fallback")
            if not command:
                raise OperationError("Real-ESRGAN 模型尚未安装", code="MODEL_NOT_INSTALLED")
            _run_portable_realesrgan_video(
                input_path,
                output_path,
                command,
                source_video,
                width,
                height,
                progress,
            )
            progress(95, "validating")
            assert_valid_output(output_path, expected_width=width, expected_height=height, input_metadata=input_metadata)
            progress(100, "completed")


ADAPTER = VideoSuperResolutionAdapter()
