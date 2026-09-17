from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path

import pytest

from fg_worker.installer import BootstrapError, install_release, public_release, safe_extract_zip, validate_release_manifest
from fg_worker.runtime_config import platform_key


def _release(artifact: dict) -> dict:
    return {
        "schemaVersion": 1,
        "releases": {
            platform_key(): {
                "version": "0.1.0-test",
                "requiredDiskBytes": 1024,
                "artifacts": [artifact],
                "runnerCommands": {"basicvsrpp-quality": "runners/basicvsrpp.exe"},
                "ffmpegDir": "ffmpeg",
            }
        },
    }


def _descriptor(path: Path) -> dict:
    payload = path.read_bytes()
    return {
        "id": "runtime-test",
        "kind": "runtime",
        "fileName": path.name,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "downloadPath": "/api/creator/worker/bootstrap/artifacts/runtime-test",
    }


def test_safe_extract_rejects_traversal(tmp_path):
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../escape.txt", "no")
    with pytest.raises(BootstrapError) as error:
        safe_extract_zip(archive, tmp_path / "out")
    assert error.value.code == "WORKER_ARCHIVE_UNSAFE"
    assert not (tmp_path / "escape.txt").exists()


def test_install_release_extracts_to_versioned_root_without_token(tmp_path, monkeypatch):
    monkeypatch.setenv("FG_WORKER_HOME", str(tmp_path / "worker data"))
    archive = tmp_path / "runtime.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("runners/basicvsrpp.exe", "runner")
        bundle.writestr("ffmpeg/ffmpeg.exe", "ffmpeg")
        bundle.writestr("ffmpeg/ffprobe.exe", "ffprobe")
    descriptor = _descriptor(archive)
    config = install_release(_release(descriptor), {descriptor["id"]: archive}, server="https://fg.example.internal")

    install_root = Path(config["installRoot"])
    assert (install_root / "runners" / "basicvsrpp.exe").read_text() == "runner"
    assert "{installRoot}/" in config["runnerCommands"]["basicvsrpp-quality"]
    assert "token" not in (tmp_path / "worker data" / "config.json").read_text(encoding="utf-8")


def test_manifest_rejects_arbitrary_download_url():
    artifact = {
        "id": "runtime-test",
        "kind": "runtime",
        "fileName": "runtime.zip",
        "bytes": 10,
        "sha256": "0" * 64,
        "downloadPath": "https://evil.invalid/runtime.zip",
    }
    with pytest.raises(BootstrapError):
        validate_release_manifest(_release(artifact), expected_platform=platform_key(), public=True)


def test_public_release_redacts_internal_storage_fields():
    artifact = {
        "id": "runtime-test",
        "kind": "runtime",
        "fileName": "runtime.zip",
        "bytes": 10,
        "sha256": "0" * 64,
        "bucket": "creator-assets",
        "path": "worker-releases/0.1/runtime.zip",
    }
    result = public_release(_release(artifact), platform=platform_key())
    assert result["artifacts"][0]["downloadPath"].startswith("/api/creator/worker/bootstrap/artifacts/")
    assert "bucket" not in result["artifacts"][0]
    assert "path" not in result["artifacts"][0]
