from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .base import OperationError
from ..runtime_config import ffmpeg_dir, runtime_environment


def executable(name: str) -> str:
    directory = ffmpeg_dir()
    candidates = [name]
    if directory:
        candidates.insert(0, str(Path(directory) / (name + (".exe" if os.name == "nt" else ""))))
    path = next((candidate for candidate in candidates if Path(candidate).is_file()), None) or shutil.which(name)
    if not path:
        raise OperationError(f"未找到 {name}，请重新运行 FG Studio Worker 安装", code="FFMPEG_NOT_INSTALLED")
    return path


def probe(path: str) -> dict[str, Any]:
    ffprobe = executable("ffprobe")
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=runtime_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise OperationError(f"读取媒体信息失败：{error}", code="MEDIA_PROBE_FAILED", retryable=True) from error
    if result.returncode != 0:
        raise OperationError("输入媒体无法解析", code="MEDIA_PROBE_FAILED")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise OperationError("FFprobe 返回无效信息", code="MEDIA_PROBE_FAILED") from error
    if not isinstance(value, dict):
        raise OperationError("FFprobe 返回无效信息", code="MEDIA_PROBE_FAILED")
    return value


def run(args: list[str], *, timeout: float | None = None) -> None:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False, env=runtime_environment())
    except (OSError, subprocess.SubprocessError) as error:
        raise OperationError(f"媒体处理进程失败：{error}", code="FFMPEG_FAILED", retryable=True) from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()[-1:]
        raise OperationError("媒体处理失败" + (f"：{detail[0][:300]}" if detail else ""), code="FFMPEG_FAILED", retryable=True)


def video_stream(metadata: dict[str, Any]) -> dict[str, Any]:
    streams = metadata.get("streams")
    if not isinstance(streams, list):
        raise OperationError("输入没有视频流", code="VIDEO_STREAM_MISSING")
    stream = next((item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"), None)
    if not stream:
        raise OperationError("输入没有视频流", code="VIDEO_STREAM_MISSING")
    return stream


def media_duration(metadata: dict[str, Any]) -> float:
    value = metadata.get("format")
    if isinstance(value, dict):
        try:
            return float(value.get("duration") or 0)
        except (TypeError, ValueError):
            pass
    return 0.0


def assert_valid_output(path: str, *, expected_width: int, expected_height: int, input_metadata: dict[str, Any]) -> None:
    output_metadata = probe(path)
    output_video = video_stream(output_metadata)
    width = int(output_video.get("width") or 0)
    height = int(output_video.get("height") or 0)
    if width != expected_width or height != expected_height:
        raise OperationError("输出分辨率校验失败", code="OUTPUT_METADATA_INVALID")
    input_duration = media_duration(input_metadata)
    output_duration = media_duration(output_metadata)
    if input_duration and output_duration and abs(input_duration - output_duration) > (1 / 24):
        raise OperationError("输出时长校验失败", code="OUTPUT_METADATA_INVALID")
    if not Path(path).is_file() or Path(path).stat().st_size <= 0:
        raise OperationError("输出文件为空", code="OUTPUT_METADATA_INVALID")
