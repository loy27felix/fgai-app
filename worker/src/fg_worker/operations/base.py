from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


ProgressCallback = Callable[[float, str | None], None]


class OperationError(ValueError):
    def __init__(self, message: str, *, code: str = "MEDIA_OPERATION_FAILED", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass
class OperationContext:
    input_path: str
    output_path: str
    request: dict[str, Any]
    progress: ProgressCallback


class OperationAdapter(ABC):
    name: str

    @abstractmethod
    def validate(self, request: dict[str, Any]) -> None:
        """Raise OperationError for an invalid or unsupported request."""

    @abstractmethod
    def run(self, input_path: str, output_path: str, request: dict[str, Any], progress: ProgressCallback) -> None:
        """Process one local input into one local output."""
