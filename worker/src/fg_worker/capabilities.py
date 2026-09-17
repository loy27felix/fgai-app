from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .runtime_config import ffmpeg_dir, runner_available


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
    directory = ffmpeg_dir()
    configured = Path(directory) / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg") if directory else None
    executable = str(configured) if configured and configured.is_file() else shutil.which("ffmpeg")
    if not executable:
        return None
    try:
        result = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=3, check=False)
        first = result.stdout.splitlines()[0] if result.stdout else ""
        return first[:160] or None
    except (OSError, subprocess.SubprocessError):
        return None


def _nvidia_device() -> tuple[str | None, int]:
    """Detect an NVIDIA device without requiring a locally installed Torch.

    The packaged Worker can ship a CUDA runner separately from Torch.  In that
    case ``nvidia-smi`` is the reliable preflight signal and still lets the
    server avoid leasing a CUDA job to a machine with no NVIDIA driver.
    """

    executable = shutil.which("nvidia-smi")
    if not executable:
        return None, 0
    try:
        result = subprocess.run(
            [executable, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None, 0
    if result.returncode != 0 or not result.stdout.strip():
        return None, 0
    first = result.stdout.splitlines()[0].strip()
    name, _, memory = first.partition(",")
    try:
        vram_bytes = int(float(memory.strip()) * 1024 * 1024) if memory.strip() else 0
    except ValueError:
        vram_bytes = 0
    return name.strip() or "NVIDIA GPU", vram_bytes


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

    # Keep the Torch result authoritative when CUDA is available, but permit a
    # packaged external runner to advertise CUDA when only the driver is
    # present.  The runner allowlist below is still required before any job is
    # claimed.
    if not cuda:
        nvidia_name, nvidia_vram = _nvidia_device()
        if nvidia_name:
            cuda = True
            gpu_name = gpu_name or nvidia_name
            vram_bytes = vram_bytes or nvidia_vram

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
        if runner_available("basicvsrpp-quality"):
            operations.append("video_super_resolution")
            profiles.append(VIDEO_PROFILES[0])
        if runner_available("realesrgan-sequence-fallback"):
            if "video_super_resolution" not in operations:
                operations.append("video_super_resolution")
            profiles.append(VIDEO_PROFILES[1])
        if runner_available("propainter-mask"):
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
