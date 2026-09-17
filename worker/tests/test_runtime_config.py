from __future__ import annotations

from pathlib import Path

import pytest

from fg_worker import runtime_config
from fg_worker.runtime_config import RuntimeConfigError, runner_args, runner_available


def test_config_round_trip_uses_user_data_override(monkeypatch, tmp_path):
    home = tmp_path / "worker home"
    monkeypatch.setenv("FG_WORKER_HOME", str(home))
    saved = runtime_config.save_runtime_config(
        runtime_config.fresh_install_config(
            server="https://fg.example.internal",
            install_root_value=home / "releases" / "0.1.0",
            release_version="0.1.0",
            runner_commands={"basicvsrpp-quality": '"{installRoot}/runners/basicvsrpp.exe"'},
            ffmpeg_dir_value="{installRoot}/ffmpeg",
        )
    )

    assert saved == home / "config.json"
    config = runtime_config.load_runtime_config()
    assert config["server"] == "https://fg.example.internal"
    assert Path(config["installRoot"]) == home / "releases" / "0.1.0"
    assert runtime_config.runner_args("basicvsrpp-quality")[0].endswith("basicvsrpp.exe")
    assert runner_available("basicvsrpp-quality") is False
    assert runtime_config.ffmpeg_dir() == home / "releases" / "0.1.0" / "ffmpeg"


def test_environment_runner_override_supports_paths_with_spaces(monkeypatch, tmp_path):
    monkeypatch.setenv("FG_WORKER_HOME", str(tmp_path))
    executable = tmp_path / "FG Studio Worker" / "runners" / "realesrgan.exe"
    command = f'"{executable}" --mode quality'
    monkeypatch.setenv("FG_WORKER_REALESRGAN_COMMAND", command)
    assert runner_args("realesrgan-sequence-fallback") == [str(executable), "--mode", "quality"]


def test_portable_realesrgan_is_not_ready_without_all_video_models(monkeypatch, tmp_path):
    root = tmp_path / "portable"
    executable = root / "realesrgan-ncnn-vulkan.exe"
    models = root / "models"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"runner")
    monkeypatch.setenv("FG_WORKER_REALESRGAN_COMMAND", f'"{executable}"')
    assert runner_available("realesrgan-sequence-fallback") is False
    models.mkdir()
    for scale in (2, 3, 4):
        for suffix in (".param", ".bin"):
            (models / f"realesr-animevideov3-x{scale}{suffix}").write_bytes(b"model")
    assert runner_available("realesrgan-sequence-fallback") is True


def test_invalid_server_and_unknown_profile_are_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv("FG_WORKER_HOME", str(tmp_path))
    with pytest.raises(RuntimeConfigError):
        runtime_config.save_runtime_config({"server": "http://public.example.com"})
    assert runtime_config.runner_args("not-a-profile") == []
