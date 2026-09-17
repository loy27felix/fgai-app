"""Safe local configuration used by packaged FG Studio Workers.

The installer writes this file after extracting a signed release.  It contains
only non-secret paths and the FG Studio server URL; the bearer token remains in
the operating-system keyring via :mod:`fg_worker.credentials`.
"""

from __future__ import annotations

import json
import os
import platform
import shlex
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from platformdirs import user_data_dir
except ImportError:  # pragma: no cover - used only by the minimal preflight executable
    def user_data_dir(appname: str, appauthor: str) -> str:
        if os.name == "nt":
            base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Local")
        elif platform.system().lower() == "darwin":
            base = str(Path.home() / "Library" / "Application Support")
        else:
            base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        return str(Path(base) / appauthor / appname)


CONFIG_VERSION = 1
SERVICE_DIR = "FG Studio"
APP_DIR = "Worker"
RUNNER_ENV = {
    "basicvsrpp-quality": "FG_WORKER_BASICVSRPP_COMMAND",
    "realesrgan-sequence-fallback": "FG_WORKER_REALESRGAN_COMMAND",
    "propainter-mask": "FG_WORKER_PROPAINTER_COMMAND",
}
PORTABLE_REALESRGAN_NAMES = {"realesrgan-ncnn-vulkan", "realesrgan-ncnn-vulkan.exe"}


class RuntimeConfigError(ValueError):
    """Raised when an installer/runtime configuration is invalid."""


def default_data_dir() -> Path:
    override = os.environ.get("FG_WORKER_HOME", "").strip()
    if override:
        candidate = Path(override).expanduser()
        if not candidate.is_absolute():
            raise RuntimeConfigError("FG_WORKER_HOME 必须是绝对路径")
        return candidate
    return Path(user_data_dir(APP_DIR, SERVICE_DIR))


def config_path() -> Path:
    return default_data_dir() / "config.json"


def default_install_root() -> Path:
    return default_data_dir() / "current"


def _safe_string(value: Any, field: str, maximum: int = 512) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value or len(value) > maximum or "\x00" in value or "\r" in value or "\n" in value:
        raise RuntimeConfigError(f"{field} 配置无效")
    return value


def _normalize_command(value: Any, field: str) -> str:
    command = _safe_string(value, field, 2048)
    if not command:
        return ""
    try:
        parts = shlex.split(command, posix=os.name != "nt")
    except ValueError as error:
        raise RuntimeConfigError(f"{field} 命令格式无效") from error
    if not parts or any("\x00" in part for part in parts):
        raise RuntimeConfigError(f"{field} 命令格式无效")
    return command


def _normalize_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeConfigError("Worker 配置必须是对象")
    version = value.get("version", CONFIG_VERSION)
    if version != CONFIG_VERSION:
        raise RuntimeConfigError("Worker 配置版本不受支持")
    server = _safe_string(value.get("server"), "server", 512)
    if server and not (server.startswith("https://") or server.startswith("http://localhost") or server.startswith("http://127.0.0.1")):
        raise RuntimeConfigError("server 必须使用 HTTPS（本机调试可使用 localhost）")
    install_root_value = value.get("installRoot")
    install_root = _safe_string(install_root_value, "installRoot", 1024) if install_root_value else str(default_install_root())
    install_root_path = Path(install_root).expanduser()
    if not install_root_path.is_absolute():
        raise RuntimeConfigError("installRoot 必须是绝对路径")
    runners_value = value.get("runnerCommands") or {}
    if not isinstance(runners_value, dict):
        raise RuntimeConfigError("runnerCommands 配置无效")
    runners: dict[str, str] = {}
    for profile, command in runners_value.items():
        if profile not in RUNNER_ENV:
            continue
        normalized = _normalize_command(command, f"runnerCommands.{profile}")
        if normalized:
            runners[profile] = normalized
    ffmpeg_dir = value.get("ffmpegDir")
    normalized_ffmpeg_dir = _safe_string(ffmpeg_dir, "ffmpegDir", 1024) if ffmpeg_dir else ""
    if normalized_ffmpeg_dir:
        ffmpeg_path = Path(normalized_ffmpeg_dir).expanduser()
        if not ffmpeg_path.is_absolute() and "{installRoot}" not in normalized_ffmpeg_dir and "{root}" not in normalized_ffmpeg_dir:
            normalized_ffmpeg_dir = str(install_root_path / ffmpeg_path)
    return {
        "version": CONFIG_VERSION,
        "server": server,
        "installRoot": str(install_root_path),
        "releaseVersion": _safe_string(value.get("releaseVersion"), "releaseVersion", 128) if value.get("releaseVersion") else "",
        "runnerCommands": runners,
        "ffmpegDir": normalized_ffmpeg_dir,
        "installedAt": _safe_string(value.get("installedAt"), "installedAt", 64) if value.get("installedAt") else "",
    }


def load_runtime_config() -> dict[str, Any]:
    path = config_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeConfigError("Worker 配置无法读取") from error
    return _normalize_config(raw)


def save_runtime_config(config: dict[str, Any]) -> Path:
    normalized = _normalize_config(config)
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return path


def configured_server() -> str | None:
    value = load_runtime_config().get("server")
    return value or None


def install_root() -> Path:
    config = load_runtime_config()
    value = config.get("installRoot")
    return Path(value) if isinstance(value, str) and value else default_install_root()


def _expand_root(value: str) -> str:
    root = str(install_root())
    return value.replace("{installRoot}", root).replace("{root}", root)


def runner_command(profile: str) -> str | None:
    env_name = RUNNER_ENV.get(profile)
    if env_name:
        override = os.environ.get(env_name, "").strip()
        if override:
            return override
    config = load_runtime_config()
    value = config.get("runnerCommands", {}).get(profile)
    if isinstance(value, str) and value.strip():
        return _expand_root(value.strip())
    return None


def runner_args(profile: str) -> list[str]:
    """Parse one configured runner command for ``subprocess.run``.

    Release manifests use a relative executable path.  After expansion it may
    contain spaces, so strip a Windows-style pair of quotes from the executable
    token before handing the argument list to Python.
    """

    command = runner_command(profile)
    if not command:
        return []
    try:
        parts = shlex.split(command, posix=os.name != "nt")
    except ValueError as error:
        raise RuntimeConfigError(f"模型 Runner {profile} 命令格式无效") from error
    if parts and len(parts[0]) >= 2 and parts[0][0] == parts[0][-1] == '"':
        parts[0] = parts[0][1:-1]
    return parts


def runner_available(profile: str) -> bool:
    """Return true only when the configured executable can actually launch."""

    parts = runner_args(profile)
    if not parts:
        return False
    executable = Path(parts[0]).expanduser()
    if executable.is_absolute() or executable.parent != Path("."):
        resolved = executable if executable.is_absolute() else Path(shutil.which(str(executable)) or executable)
    else:
        resolved = Path(shutil.which(parts[0]) or "")
    if not resolved.is_file():
        return False
    if profile == "realesrgan-sequence-fallback" and resolved.name.lower() in PORTABLE_REALESRGAN_NAMES:
        model_roots = (resolved.parent / "models", resolved.parent.parent / "models")
        required = [f"realesr-animevideov3-x{scale}{suffix}" for scale in (2, 3, 4) for suffix in (".param", ".bin")]
        return any(all((root / file_name).is_file() for file_name in required) for root in model_roots)
    return True


def ffmpeg_dir() -> Path | None:
    override = os.environ.get("FG_WORKER_FFMPEG_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    value = load_runtime_config().get("ffmpegDir")
    if not isinstance(value, str) or not value:
        return None
    return Path(_expand_root(value)).expanduser()


def runtime_environment() -> dict[str, str]:
    """Return a child-process environment with the bundled tools on PATH."""

    environment = dict(os.environ)
    directory = ffmpeg_dir()
    if directory:
        environment["PATH"] = str(directory) + os.pathsep + environment.get("PATH", "")
    return environment


def fresh_install_config(*, server: str, install_root_value: Path, release_version: str, runner_commands: dict[str, str], ffmpeg_dir_value: str) -> dict[str, Any]:
    return {
        "version": CONFIG_VERSION,
        "server": server,
        "installRoot": str(install_root_value),
        "releaseVersion": release_version,
        "runnerCommands": runner_commands,
        "ffmpegDir": ffmpeg_dir_value,
        "installedAt": datetime.now(timezone.utc).isoformat(),
    }


def platform_key() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "windows":
        normalized = "amd64" if machine in {"amd64", "x86_64", "x64"} else machine
        return f"windows-{normalized}"
    if system == "darwin":
        normalized = "arm64" if machine in {"arm64", "aarch64"} else machine
        return f"macos-{normalized}"
    raise RuntimeConfigError("当前平台没有可用的 FG Studio Worker 安装包")
