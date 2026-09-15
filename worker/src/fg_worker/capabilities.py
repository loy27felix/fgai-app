from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any


VIDEO_PROFILES = ["basicvsrpp-quality", "realesrgan-sequence-fallback"]
WATERMARK_PROFILES = ["propainter-mask"]


def _torch_module():
    try:
        import torch  # type: ignore

        return torch
    except Exception:
        return None


def _is_available(value: Any) -> bool:
    try:
        return bool(value()) if callable(value) else bool(value)
    except Exception:
        return False


def _system_memory_bytes() -> int:
    try:
        import psutil  # type: ignore

        return int(psutil.virtual_memory().total)
    except Exception:
        if hasattr(os, "sysconf"):
            try:
                return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))
            except (ValueError, OSError):
                pass
        return 0


def _ffmpeg_version() -> str | None:
    executable = shutil.which("ffmpeg")
    if not executable:
        return None
    try:
        result = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=3, check=False)
        first = result.stdout.splitlines()[0] if result.stdout else ""
        return first[:160] or None
    except (OSError, subprocess.SubprocessError):
        return None


def detect_capabilities() -> dict[str, Any]:
    """Return a JSON-safe, conservative capability document.

    A missing backend is never advertised. CPU is always reported as a
    fallback backend, but heavy operations are only advertised when a GPU
    backend is actually available.
    """

    torch = _torch_module()
    cuda = False
    mps = False
    gpu_name: str | None = None
    vram_bytes = 0
    if torch is not None:
        cuda = _is_available(getattr(getattr(torch, "cuda", None), "is_available", None))
        mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
        mps = _is_available(getattr(mps_backend, "is_available", None))
        if cuda:
            try:
                gpu_name = str(torch.cuda.get_device_name(0))
                free, total = torch.cuda.mem_get_info(0)
                vram_bytes = int(total)
            except Exception:
                gpu_name = gpu_name or "CUDA GPU"
        elif mps:
            gpu_name = "Apple Silicon GPU"

    backends: list[str] = []
    if cuda:
        backends.append("cuda")
    if mps:
        backends.append("mps")
    backends.append("cpu")

    operations: list[str] = []
    profiles: list[str] = []
    # A GPU alone is not enough to claim a job.  Only advertise a profile when
    # its verified local runner is configured; otherwise the queue would lease
    # work that can only fail with MODEL_NOT_INSTALLED.
    if cuda or mps:
        if os.environ.get("FG_WORKER_BASICVSRPP_COMMAND"):
            operations.append("video_super_resolution")
            profiles.append(VIDEO_PROFILES[0])
        if os.environ.get("FG_WORKER_REALESRGAN_COMMAND"):
            if "video_super_resolution" not in operations:
                operations.append("video_super_resolution")
            profiles.append(VIDEO_PROFILES[1])
        if os.environ.get("FG_WORKER_PROPAINTER_COMMAND"):
            operations.append("watermark_removal")
            profiles.extend(WATERMARK_PROFILES)

    # 2 GiB input and 4K output are the server-side admission ceilings. A
    # real benchmark can lower these values before the Worker is paired.
    return {
        "os": platform.system().lower(),
        "architecture": platform.machine().lower(),
        "gpuName": gpu_name,
        "vramBytes": vram_bytes,
        "ramBytes": _system_memory_bytes(),
        "backends": backends,
        "operations": operations,
        "modelProfiles": profiles,
        "maxInputBytes": 2 * 1024 * 1024 * 1024,
        "maxOutputPixels": 3840 * 2160,
        "ffmpegVersion": _ffmpeg_version(),
    }
