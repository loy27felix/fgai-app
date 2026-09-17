import pytest

from fg_worker.operations.base import OperationError
from fg_worker.operations.registry import get_operation
from fg_worker.operations.video_super_resolution import _frame_rate, _portable_scale


def test_super_resolution_request_preserves_audio_and_duration():
    adapter = get_operation("video_super_resolution")
    assert adapter.validate({"targetResolution": "1080p", "modelProfile": "basicvsrpp-quality"}) is None


def test_super_resolution_rejects_cpu():
    adapter = get_operation("video_super_resolution")
    with pytest.raises(OperationError):
        adapter.run("missing.mp4", "out.mp4", {"targetResolution": "1080p", "modelProfile": "basicvsrpp-quality", "backend": "cpu"}, lambda *_: None)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("24000/1001", pytest.approx(23.976, rel=1e-4)), ("", 30.0), ("0/0", 30.0), ("999", 120.0)],
)
def test_portable_runner_parses_safe_frame_rate(value, expected):
    assert _frame_rate(value) == expected


def test_portable_runner_chooses_native_scale_that_reaches_target():
    assert _portable_scale({"width": 640, "height": 360}, 1920, 1080) == 3
    assert _portable_scale({"width": 1280, "height": 720}, 1920, 1080) == 2
    assert _portable_scale({"width": 320, "height": 180}, 3840, 2160) == 4


def test_realesrgan_profile_uses_video_sequence_adapter(monkeypatch):
    import fg_worker.operations.video_super_resolution as module

    adapter = get_operation("video_super_resolution")
    monkeypatch.setattr(module, "probe", lambda _path: {"streams": [{"codec_type": "video", "width": 640, "height": 360, "avg_frame_rate": "30/1"}], "format": {"duration": "1"}})
    monkeypatch.setattr(module, "video_stream", lambda metadata: metadata["streams"][0])
    monkeypatch.setattr(module, "runner_args", lambda _profile: ["realesrgan-ncnn-vulkan.exe"])
    monkeypatch.setattr(module, "_run_portable_realesrgan_video", lambda *args: args[-1](20, "upscaling"))
    monkeypatch.setattr(module, "assert_valid_output", lambda *args, **kwargs: None)
    progress: list[tuple[float, str | None]] = []
    adapter.run(
        "input.mp4",
        "output.bin",
        {"targetResolution": "1080p", "modelProfile": "realesrgan-sequence-fallback", "backend": "cuda"},
        lambda value, phase=None: progress.append((value, phase)),
    )
    assert (20, "upscaling") in progress


def test_watermark_operation_requires_mask_file():
    adapter = get_operation("watermark_removal")
    with pytest.raises(Exception) as error:
        adapter.validate({"modelProfile": "propainter-mask", "maskPath": None})
    assert "mask" in str(error.value).lower() or "遮罩" in str(error.value)
