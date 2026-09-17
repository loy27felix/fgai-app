from pathlib import Path


def test_windows_preflight_fails_closed_without_gpu_or_packaged_runner():
    script = Path(__file__).parents[1] / "packaging" / "windows" / "preflight.ps1"
    text = script.read_text(encoding="utf-8")
    assert "nvidia-smi" in text
    assert "ffmpeg" in text
    assert "runnerCommands" in text
    assert "if (-not $ready) { exit 1 }" in text
