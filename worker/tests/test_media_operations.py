import pytest

from fg_worker.operations.base import OperationError
from fg_worker.operations.registry import get_operation


def test_super_resolution_request_preserves_audio_and_duration():
    adapter = get_operation("video_super_resolution")
    assert adapter.validate({"targetResolution": "1080p", "modelProfile": "basicvsrpp-quality"}) is None


def test_super_resolution_rejects_cpu():
    adapter = get_operation("video_super_resolution")
    with pytest.raises(OperationError):
        adapter.run("missing.mp4", "out.mp4", {"targetResolution": "1080p", "modelProfile": "basicvsrpp-quality", "backend": "cpu"}, lambda *_: None)


def test_watermark_operation_requires_mask_file():
    adapter = get_operation("watermark_removal")
    with pytest.raises(Exception) as error:
        adapter.validate({"modelProfile": "propainter-mask", "maskPath": None})
    assert "mask" in str(error.value).lower() or "遮罩" in str(error.value)
