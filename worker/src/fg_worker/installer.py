"""Zero-install bootstrap for the packaged FG Studio Worker.

The end-user executable calls this module; it does not ask the user to install
Python, FFmpeg, PyTorch, CUDA/MPS or model weights.  The server publishes a
small, signed-by-configuration release manifest and the bootstrapper downloads
only the allow-listed artifacts for the current platform.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .capabilities import detect_capabilities
from .client import WorkerClient
from .credentials import save_token
from .runtime_config import (
    default_data_dir,
    fresh_install_config,
    platform_key,
    save_runtime_config,
)


MAX_ARTIFACT_BYTES = 64 * 1024 * 1024 * 1024
MAX_ZIP_MEMBERS = 100_000
MAX_ZIP_UNCOMPRESSED_BYTES = 96 * 1024 * 1024 * 1024
ARTIFACT_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ALLOWED_KINDS = {"installer", "runtime", "model", "ffmpeg"}


class BootstrapError(RuntimeError):
    """A client-safe bootstrap error with a stable code."""

    def __init__(self, message: str, code: str = "WORKER_BOOTSTRAP_FAILED"):
        super().__init__(message)
        self.code = code


def _text(value: Any, field: str, *, maximum: int = 1024) -> str:
    if not isinstance(value, str):
        raise BootstrapError(f"发布清单字段 {field} 无效", "WORKER_MANIFEST_INVALID")
    value = value.strip()
    if not value or len(value) > maximum or "\x00" in value or "\r" in value or "\n" in value:
        raise BootstrapError(f"发布清单字段 {field} 无效", "WORKER_MANIFEST_INVALID")
    return value


def _safe_file_name(value: Any) -> str:
    name = _text(value, "fileName", maximum=256)
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or len(candidate.parts) != 1 or candidate.name in {"", ".", ".."} or "\\" in name:
        raise BootstrapError("发布清单文件名无效", "WORKER_MANIFEST_INVALID")
    return name


def _safe_download_path(value: Any, artifact_id: str) -> str:
    path = _text(value, "downloadPath", maximum=512)
    parsed = urllib.parse.urlparse(path)
    if parsed.scheme or parsed.netloc or not path.startswith("/api/creator/worker/bootstrap/artifacts/"):
        raise BootstrapError("发布清单下载地址必须是服务端同源路径", "WORKER_MANIFEST_INVALID")
    if artifact_id not in PurePosixPath(parsed.path).parts:
        raise BootstrapError("发布清单下载地址与 artifact 不匹配", "WORKER_MANIFEST_INVALID")
    if any(part in {"", ".", ".."} for part in PurePosixPath(parsed.path).parts):
        raise BootstrapError("发布清单下载地址无效", "WORKER_MANIFEST_INVALID")
    return path


def _validate_artifact(value: Any, *, public: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BootstrapError("发布清单 artifact 无效", "WORKER_MANIFEST_INVALID")
    artifact_id = _text(value.get("id"), "artifact.id", maximum=128)
    if not ARTIFACT_ID.fullmatch(artifact_id):
        raise BootstrapError("发布清单 artifact ID 无效", "WORKER_MANIFEST_INVALID")
    kind = _text(value.get("kind"), "artifact.kind", maximum=32)
    if kind not in ALLOWED_KINDS:
        raise BootstrapError("发布清单 artifact 类型不受支持", "WORKER_MANIFEST_INVALID")
    file_name = _safe_file_name(value.get("fileName"))
    try:
        byte_count = int(value.get("bytes"))
    except (TypeError, ValueError):
        byte_count = 0
    if byte_count <= 0 or byte_count > MAX_ARTIFACT_BYTES:
        raise BootstrapError("发布清单 artifact 大小无效", "WORKER_MANIFEST_INVALID")
    digest = _text(value.get("sha256"), "artifact.sha256", maximum=64).lower()
    if not SHA256.fullmatch(digest):
        raise BootstrapError("发布清单 artifact SHA-256 无效", "WORKER_MANIFEST_INVALID")
    result = {"id": artifact_id, "kind": kind, "fileName": file_name, "bytes": byte_count, "sha256": digest}
    if public:
        result["downloadPath"] = _safe_download_path(value.get("downloadPath"), artifact_id)
    else:
        bucket = _text(value.get("bucket"), "artifact.bucket", maximum=128)
        storage_path = _text(value.get("path"), "artifact.path", maximum=1024)
        if bucket in {".", ".."} or "/" in bucket or "\\" in bucket or "\x00" in bucket:
            raise BootstrapError("发布清单存储空间无效", "WORKER_MANIFEST_INVALID")
        if storage_path.startswith("/") or any(part in {"", ".", ".."} for part in PurePosixPath(storage_path).parts):
            raise BootstrapError("发布清单存储路径无效", "WORKER_MANIFEST_INVALID")
        result["bucket"] = bucket
        result["path"] = storage_path
    return result


def validate_release_manifest(value: Any, *, expected_platform: str | None = None, public: bool = True) -> dict[str, Any]:
    """Validate and normalize a release manifest.

    ``public=False`` is used only by the server-side loader; ``public=True``
    rejects raw NAS fields so a client can never be tricked into reading an
    arbitrary bucket/path.
    """

    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise BootstrapError("发布清单版本不受支持", "WORKER_MANIFEST_INVALID")
    releases = value.get("releases")
    if not isinstance(releases, dict) or not releases:
        raise BootstrapError("发布清单没有可用版本", "WORKER_RELEASE_UNAVAILABLE")
    normalized_releases: dict[str, dict[str, Any]] = {}
    for release_platform, release_value in releases.items():
        if not isinstance(release_platform, str) or not re.fullmatch(r"(?:windows|macos)-[A-Za-z0-9._-]+", release_platform):
            raise BootstrapError("发布清单平台无效", "WORKER_MANIFEST_INVALID")
        if not isinstance(release_value, dict):
            raise BootstrapError("发布清单版本无效", "WORKER_MANIFEST_INVALID")
        if expected_platform and release_platform != expected_platform:
            continue
        version = _text(release_value.get("version"), "release.version", maximum=128)
        try:
            required_disk = int(release_value.get("requiredDiskBytes"))
        except (TypeError, ValueError):
            required_disk = 0
        if required_disk <= 0 or required_disk > MAX_ARTIFACT_BYTES * 2:
            raise BootstrapError("发布清单磁盘需求无效", "WORKER_MANIFEST_INVALID")
        artifacts_value = release_value.get("artifacts")
        if not isinstance(artifacts_value, list) or not artifacts_value:
            raise BootstrapError("发布清单没有 artifact", "WORKER_MANIFEST_INVALID")
        artifacts: list[dict[str, Any]] = []
        seen: set[str] = set()
        for artifact_value in artifacts_value:
            artifact = _validate_artifact(artifact_value, public=public)
            if artifact["id"] in seen:
                raise BootstrapError("发布清单存在重复 artifact", "WORKER_MANIFEST_INVALID")
            seen.add(artifact["id"])
            artifacts.append(artifact)
        if not any(item["kind"] == "runtime" for item in artifacts):
            raise BootstrapError("发布清单缺少 Worker runtime", "WORKER_MANIFEST_INVALID")
        commands = release_value.get("runnerCommands") or {}
        if not isinstance(commands, dict):
            raise BootstrapError("发布清单 Runner 配置无效", "WORKER_MANIFEST_INVALID")
        runner_commands: dict[str, str] = {}
        for profile, command in commands.items():
            if not isinstance(profile, str) or len(profile) > 128:
                raise BootstrapError("发布清单 Runner 配置无效", "WORKER_MANIFEST_INVALID")
            command_text = _text(command, f"runnerCommands.{profile}", maximum=2048)
            if command_text.startswith("/") or ".." in PurePosixPath(command_text.split()[0]).parts:
                raise BootstrapError("发布清单 Runner 路径无效", "WORKER_MANIFEST_INVALID")
            runner_commands[profile] = command_text
        ffmpeg_dir = release_value.get("ffmpegDir", "")
        if ffmpeg_dir:
            ffmpeg_dir = _text(ffmpeg_dir, "ffmpegDir", maximum=512)
            if ffmpeg_dir.startswith("/") or ".." in PurePosixPath(ffmpeg_dir).parts:
                raise BootstrapError("发布清单 FFmpeg 路径无效", "WORKER_MANIFEST_INVALID")
        worker_executable = release_value.get("workerExecutable", "")
        if worker_executable:
            worker_executable = _safe_file_name(worker_executable) if "/" not in str(worker_executable) and "\\" not in str(worker_executable) else _text(worker_executable, "workerExecutable", maximum=256)
            if any(part in {"", ".", ".."} for part in PurePosixPath(worker_executable).parts):
                raise BootstrapError("发布清单 Worker 启动路径无效", "WORKER_MANIFEST_INVALID")
        normalized_releases[release_platform] = {
            "platform": release_platform,
            "version": version,
            "requiredDiskBytes": required_disk,
            "artifacts": artifacts,
            "runnerCommands": runner_commands,
            "ffmpegDir": ffmpeg_dir,
            "workerExecutable": worker_executable,
        }
    if expected_platform and expected_platform not in normalized_releases:
        raise BootstrapError("当前平台暂未发布 Worker 安装包", "WORKER_RELEASE_UNAVAILABLE")
    return {"schemaVersion": 1, "releases": normalized_releases}


def public_release(value: Mapping[str, Any], *, platform: str) -> dict[str, Any]:
    """Return one redacted release suitable for the installer response."""

    # The server-side source manifest contains the NAS bucket/path.  Validate
    # those fields here, then replace them with an opaque artifact route before
    # the object is sent to a client.
    manifest = validate_release_manifest(value, expected_platform=platform, public=False)
    release = manifest["releases"][platform]
    artifacts = [
        {
            "id": artifact["id"],
            "kind": artifact["kind"],
            "fileName": artifact["fileName"],
            "bytes": artifact["bytes"],
            "sha256": artifact["sha256"],
            "downloadPath": f"/api/creator/worker/bootstrap/artifacts/{urllib.parse.quote(artifact['id'], safe='')}?platform={urllib.parse.quote(platform, safe='')}",
        }
        for artifact in release["artifacts"]
    ]
    return {
        "schemaVersion": 1,
        "platform": platform,
        "version": release["version"],
        "requiredDiskBytes": release["requiredDiskBytes"],
        "artifacts": artifacts,
        "runnerCommands": release["runnerCommands"],
        "ffmpegDir": release["ffmpegDir"],
        "workerExecutable": release["workerExecutable"],
    }


def _server_url(value: str) -> str:
    server = _text(value, "server", maximum=512).rstrip("/")
    parsed = urllib.parse.urlparse(server)
    local_http = parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local_http):
        raise BootstrapError("FG Studio 地址必须使用 HTTPS", "WORKER_SERVER_INVALID")
    return server


def _request_json(url: str, *, pairing_code: str, timeout: float = 60.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"accept": "application/json", "x-fg-worker-pairing-code": pairing_code},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL is HTTPS/operator configured
            body = response.read()
            status = int(response.status)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
            message = payload.get("error") if isinstance(payload, dict) else None
            code = payload.get("code") if isinstance(payload, dict) else None
        except Exception:
            message, code = None, None
        raise BootstrapError(str(message or "下载安装包失败"), str(code or "WORKER_BOOTSTRAP_HTTP_FAILED")) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise BootstrapError("无法连接 FG Studio，请检查网络后重试", "WORKER_BOOTSTRAP_NETWORK_FAILED") from error
    if status >= 400:
        raise BootstrapError("下载安装包失败", "WORKER_BOOTSTRAP_HTTP_FAILED")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BootstrapError("服务端返回的发布清单无效", "WORKER_MANIFEST_INVALID") from error
    if not isinstance(value, dict):
        raise BootstrapError("服务端返回的发布清单无效", "WORKER_MANIFEST_INVALID")
    return value


def fetch_manifest(server: str, pairing_code: str) -> dict[str, Any]:
    server = _server_url(server)
    code = _text(pairing_code, "pairingCode", maximum=64)
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", code):
        raise BootstrapError("配对码无效或已过期", "PAIRING_CODE_INVALID")
    parsed = platform_key().split("-", 1)
    query = urllib.parse.urlencode({"platform": platform_key(), "architecture": parsed[-1]})
    value = _request_json(f"{server}/api/creator/worker/bootstrap/manifest?{query}", pairing_code=code)
    # The server response is already redacted, but validate again at the trust
    # boundary before any artifact is downloaded. The route returns one
    # platform release, while the offline installer uses the common releases
    # envelope internally.
    envelope = {"schemaVersion": 1, "releases": {platform_key(): value}}
    normalized = validate_release_manifest(envelope, expected_platform=platform_key(), public=True)
    return {**normalized["releases"][platform_key()], "server": server}


def _hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def verify_artifact(path: Path, descriptor: Mapping[str, Any]) -> None:
    expected_size = int(descriptor["bytes"])
    expected_digest = str(descriptor["sha256"]).lower()
    actual_size, actual_digest = _hash_file(path)
    if actual_size != expected_size or actual_digest != expected_digest:
        raise BootstrapError(f"下载校验失败：{descriptor.get('fileName', path.name)}", "WORKER_ARTIFACT_CHECKSUM_MISMATCH")


def download_artifact(server: str, pairing_code: str, descriptor: Mapping[str, Any], destination: Path) -> Path:
    server = _server_url(server)
    artifact_id = _text(descriptor.get("id"), "artifact.id", maximum=128)
    path = _safe_download_path(descriptor.get("downloadPath"), artifact_id)
    expected_size = int(descriptor.get("bytes"))
    if expected_size <= 0 or expected_size > MAX_ARTIFACT_BYTES:
        raise BootstrapError("发布 artifact 大小无效", "WORKER_MANIFEST_INVALID")
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".part")
    request = urllib.request.Request(server + path, headers={"x-fg-worker-pairing-code": pairing_code}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - same-origin path validated above
            size = 0
            with partial.open("wb") as stream:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > expected_size:
                        raise BootstrapError("下载文件超过清单大小", "WORKER_ARTIFACT_SIZE_MISMATCH")
                    stream.write(chunk)
    except BootstrapError:
        partial.unlink(missing_ok=True)
        raise
    except urllib.error.HTTPError as error:
        partial.unlink(missing_ok=True)
        raise BootstrapError("下载安装包失败，请稍后重试", "WORKER_ARTIFACT_DOWNLOAD_FAILED") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        partial.unlink(missing_ok=True)
        raise BootstrapError("下载中断，请检查网络后重试", "WORKER_ARTIFACT_DOWNLOAD_FAILED") from error
    try:
        verify_artifact(partial, descriptor)
        os.replace(partial, destination)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    return destination


def _zip_member_path(root: Path, member: zipfile.ZipInfo) -> Path:
    name = member.filename.replace("\\", "/")
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise BootstrapError("运行包包含非法路径", "WORKER_ARCHIVE_UNSAFE")
    mode = (member.external_attr >> 16) & 0o170000
    if mode == 0o120000:
        raise BootstrapError("运行包不允许包含符号链接", "WORKER_ARCHIVE_UNSAFE")
    target = (root / Path(*candidate.parts)).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        raise BootstrapError("运行包路径越界", "WORKER_ARCHIVE_UNSAFE")
    return target


def safe_extract_zip(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > MAX_ZIP_MEMBERS:
                raise BootstrapError("运行包文件数量过多", "WORKER_ARCHIVE_UNSAFE")
            for member in members:
                target = _zip_member_path(destination, member)
                total += int(member.file_size)
                if total > MAX_ZIP_UNCOMPRESSED_BYTES:
                    raise BootstrapError("运行包解压空间超过限制", "WORKER_ARCHIVE_UNSAFE")
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member, "r") as source, target.open("wb") as sink:
                    shutil.copyfileobj(source, sink, length=1024 * 1024)
    except zipfile.BadZipFile as error:
        raise BootstrapError("运行包不是有效 ZIP", "WORKER_ARCHIVE_INVALID") from error


def _relative_install_value(value: str, *, placeholder: str = "{installRoot}", quote: bool = False) -> str:
    value = value.replace("\\", "/").strip()
    if not value:
        return ""
    result = value if value.startswith(placeholder) else f"{placeholder}/{value.lstrip('/')}"
    return f'"{result}"' if quote and not (result.startswith('"') and result.endswith('"')) else result


def _resolve_release_path(value: str, root: Path) -> Path:
    """Resolve a manifest path against a staged release without escaping it."""

    expanded = value.replace("{installRoot}", str(root)).replace("{root}", str(root))
    candidate = Path(expanded).expanduser()
    return candidate if candidate.is_absolute() else root / candidate


def _command_executable(command: str, root: Path) -> Path:
    try:
        parts = shlex.split(command.replace("{installRoot}", str(root)).replace("{root}", str(root)), posix=os.name != "nt")
    except ValueError as error:
        raise BootstrapError("发布清单 Runner 命令格式无效", "WORKER_MANIFEST_INVALID") from error
    if not parts:
        raise BootstrapError("发布清单 Runner 命令为空", "WORKER_MANIFEST_INVALID")
    executable = parts[0]
    if len(executable) >= 2 and executable[0] == executable[-1] == '"':
        executable = executable[1:-1]
    return _resolve_release_path(executable, root)


def install_release(manifest: Mapping[str, Any], artifacts: Mapping[str, Path], *, server: str) -> dict[str, Any]:
    """Install already-downloaded artifacts and atomically publish config.

    This function is intentionally independent of HTTP so a maintainer can
    test an offline release bundle without ever writing a token or touching the
    current installed version.
    """

    release = validate_release_manifest(manifest, expected_platform=platform_key(), public=True)["releases"][platform_key()]
    # The setup executable is the artifact currently running and is not
    # downloaded again. Runtime/model/FFmpeg artifacts are the install set.
    artifact_by_id = {item["id"]: item for item in release["artifacts"] if item["kind"] != "installer"}
    if set(artifacts) != set(artifact_by_id):
        raise BootstrapError("下载的 artifact 与发布清单不一致", "WORKER_MANIFEST_INVALID")
    data_dir = default_data_dir()
    staging_root = data_dir / "staging"
    releases_root = data_dir / "releases"
    staging_root.mkdir(parents=True, exist_ok=True)
    releases_root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f"{release['version']}-", dir=staging_root))
    try:
        for artifact_id, descriptor in artifact_by_id.items():
            path = Path(artifacts[artifact_id])
            if not path.is_file():
                raise BootstrapError("安装包文件不存在", "WORKER_ARTIFACT_MISSING")
            verify_artifact(path, descriptor)
            if descriptor["kind"] in {"runtime", "model", "ffmpeg"}:
                if path.suffix.lower() == ".zip":
                    safe_extract_zip(path, stage)
                else:
                    destination = stage / descriptor["fileName"]
                    shutil.copy2(path, destination)
        # Fail before publishing the new version if the package forgot a
        # declared executable. This keeps a broken release from ever becoming
        # the active config and avoids asking end users to install anything.
        for profile, command in release["runnerCommands"].items():
            executable = _command_executable(command, stage)
            if not executable.is_file():
                raise BootstrapError(f"运行包缺少 {profile} 模型 Runner", "WORKER_RUNTIME_MISSING")
        if release["ffmpegDir"]:
            ffmpeg_root = _resolve_release_path(release["ffmpegDir"], stage)
            for tool in ("ffmpeg.exe", "ffprobe.exe") if os.name == "nt" else ("ffmpeg", "ffprobe"):
                if not (ffmpeg_root / tool).is_file():
                    raise BootstrapError("运行包缺少 FFmpeg/FFprobe", "WORKER_RUNTIME_MISSING")
        if release["workerExecutable"]:
            worker_executable = _resolve_release_path(release["workerExecutable"], stage)
            if not worker_executable.is_file():
                raise BootstrapError("运行包缺少 Worker 启动文件", "WORKER_RUNTIME_MISSING")
        release_dir = releases_root / release["version"]
        if release_dir.exists():
            release_dir = releases_root / f"{release['version']}-{uuid.uuid4().hex[:8]}"
        os.replace(stage, release_dir)
        runner_commands = {profile: _relative_install_value(command, quote=True) for profile, command in release["runnerCommands"].items()}
        ffmpeg_dir = _relative_install_value(release["ffmpegDir"]) if release["ffmpegDir"] else ""
        config = fresh_install_config(
            server=_server_url(server),
            install_root_value=release_dir,
            release_version=release["version"],
            runner_commands=runner_commands,
            ffmpeg_dir_value=ffmpeg_dir,
        )
        save_runtime_config(config)
        return config
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _prompt_values(server_default: str = "") -> tuple[str, str]:
    try:
        import tkinter as tk
        from tkinter import simpledialog

        root = tk.Tk()
        root.withdraw()
        server = server_default or simpledialog.askstring("FG Studio Worker", "FG Studio 地址（通常已预填）:", initialvalue=_default_server(), parent=root) or ""
        code = simpledialog.askstring("FG Studio Worker", "粘贴画布中的一次性配对码:", parent=root) or ""
        root.destroy()
        return server.strip(), code.strip()
    except Exception as error:
        raise BootstrapError("请重新打开安装包并填写 FG Studio 地址与一次性配对码", "WORKER_SETUP_INPUT_REQUIRED") from error


def _default_server() -> str:
    configured = os.environ.get("FG_STUDIO_SERVER_URL", "").strip()
    if configured:
        return configured
    bundled = Path(__file__).with_name("default-server.txt")
    try:
        return bundled.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def launch_worker(config: Mapping[str, Any], *, no_launch: bool = False) -> bool:
    root = Path(str(config["installRoot"]))
    configured = str(config.get("workerExecutable") or "")
    candidates = [root / configured] if configured else []
    candidates.extend([root / "fg-worker.exe", root / "fg-worker", root / "bin" / "fg-worker.exe", root / "bin" / "fg-worker"])
    executable = next((path for path in candidates if path.is_file()), None)
    if executable is None:
        raise BootstrapError("运行包缺少 Worker 启动文件，请重新下载安装包", "WORKER_RUNTIME_MISSING")
    if no_launch:
        return False
    install_autostart(executable)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    subprocess.Popen([str(executable), "run"], cwd=str(root), creationflags=flags)  # noqa: S603 - executable comes from validated release
    return True


def _assert_install_capacity(required_bytes: int) -> None:
    try:
        probe = default_data_dir()
        while not probe.exists() and probe != probe.parent:
            probe = probe.parent
        free_bytes = shutil.disk_usage(probe).free
    except OSError as error:
        raise BootstrapError("无法检查本机磁盘空间", "WORKER_DISK_CHECK_FAILED") from error
    if free_bytes < required_bytes:
        raise BootstrapError("本机可用磁盘空间不足，无法安装模型运行包", "WORKER_DISK_SPACE_INSUFFICIENT")


def _assert_platform_hardware() -> None:
    capabilities = detect_capabilities()
    backends = capabilities.get("backends") if isinstance(capabilities, dict) else []
    if platform_key().startswith("windows-") and "cuda" not in backends:
        raise BootstrapError("未检测到可用的 NVIDIA CUDA 环境", "WORKER_GPU_UNAVAILABLE")
    if platform_key().startswith("macos-") and "mps" not in backends:
        raise BootstrapError("未检测到可用的 Apple Silicon GPU", "WORKER_GPU_UNAVAILABLE")


def install_autostart(executable: Path) -> None:
    """Keep the Worker available after reboot without an admin install."""

    if os.name == "nt":
        try:
            import winreg

            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                winreg.SetValueEx(key, "FG Studio Worker", 0, winreg.REG_SZ, f'"{executable}" run')
        except Exception as error:
            raise BootstrapError("无法设置 Worker 开机启动，请以管理员允许安装", "WORKER_AUTOSTART_FAILED") from error
        return
    if sys.platform == "darwin":
        launch_agents = Path.home() / "Library" / "LaunchAgents"
        launch_agents.mkdir(parents=True, exist_ok=True)
        plist = launch_agents / "ai.fgstudio.worker.plist"
        escaped = str(executable).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        plist.write_text(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
            "<plist version=\"1.0\"><dict>"
            "<key>Label</key><string>ai.fgstudio.worker</string>"
            f"<key>ProgramArguments</key><array><string>{escaped}</string><string>run</string></array>"
            "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>"
            "</dict></plist>\n",
            encoding="utf-8",
        )


def pair_and_install(server: str, pairing_code: str, *, name: str | None = None, no_launch: bool = False) -> dict[str, Any]:
    manifest = fetch_manifest(server, pairing_code)
    release = manifest
    _assert_platform_hardware()
    _assert_install_capacity(int(release["requiredDiskBytes"]))
    data_dir = default_data_dir()
    download_dir = data_dir / "downloads" / str(release["version"])
    downloaded: dict[str, Path] = {}
    for descriptor in release["artifacts"]:
        if descriptor["kind"] == "installer":
            continue
        destination = download_dir / descriptor["fileName"]
        downloaded[descriptor["id"]] = download_artifact(server, pairing_code, descriptor, destination)
    config = install_release({"schemaVersion": 1, "releases": {platform_key(): release}}, downloaded, server=server)
    capabilities = detect_capabilities()
    client = WorkerClient(server, token="pairing-not-used")
    result = client.register(
        pairing_code,
        capabilities,
        name=(name or platform.node() or "本机 Worker"),
        platform=sys.platform,
        architecture=platform_key().split("-", 1)[-1],
    )
    token = result.get("token") if isinstance(result, dict) else None
    if not isinstance(token, str) or len(token) < 20:
        raise BootstrapError("服务端没有返回 Worker 令牌", "WORKER_REGISTER_FAILED")
    save_token(token)
    launched = launch_worker({**config, "workerExecutable": release.get("workerExecutable", "")}, no_launch=no_launch)
    return {"paired": True, "workerId": result.get("workerId"), "version": release["version"], "launched": launched}


def setup_from_cli(server: str | None, code: str | None, *, name: str | None = None, no_launch: bool = False) -> dict[str, Any]:
    server = server or _default_server()
    if not server or not code:
        prompted_server, prompted_code = _prompt_values(server)
        server, code = prompted_server, prompted_code
    if not server or not code:
        raise BootstrapError("必须填写 FG Studio 地址和一次性配对码", "WORKER_SETUP_INPUT_REQUIRED")
    return pair_and_install(server, code, name=name, no_launch=no_launch)
