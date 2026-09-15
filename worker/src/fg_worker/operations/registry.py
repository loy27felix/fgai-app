from __future__ import annotations

from .base import OperationAdapter, OperationError
from .video_super_resolution import ADAPTER as VIDEO_SUPER_RESOLUTION
from .watermark_removal import ADAPTER as WATERMARK_REMOVAL


_OPERATIONS: dict[str, OperationAdapter] = {
    "video_super_resolution": VIDEO_SUPER_RESOLUTION,
    "watermark_removal": WATERMARK_REMOVAL,
}


def get_operation(name: str) -> OperationAdapter:
    try:
        return _OPERATIONS[name]
    except KeyError as error:
        raise OperationError("当前 Worker 不支持该媒体处理操作", code="OPERATION_UNSUPPORTED") from error

