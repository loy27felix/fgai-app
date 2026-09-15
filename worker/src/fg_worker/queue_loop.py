from __future__ import annotations

import hashlib
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .client import WorkerApiError, WorkerClient


OperationRunner = Callable[[str, str, dict[str, Any], Callable[[float, str | None], None]], None]


def default_operation_runner(input_path: str, output_path: str, request: dict[str, Any], progress: Callable[[float, str | None], None]) -> None:
    from .operations.registry import get_operation

    operation = request.get("operation")
    if not isinstance(operation, str):
        raise WorkerApiError("任务没有操作类型", code="INVALID_MEDIA_JOB")
    get_operation(operation).run(input_path, output_path, request, progress)


class WorkerLoop:
    HEARTBEAT_SECONDS = 20
    POLL_SECONDS = 3
    CHUNK_BYTES = 8 * 1024 * 1024

    def __init__(self, client: WorkerClient, capabilities: dict[str, Any], runner: OperationRunner | None = None):
        self.client = client
        self.capabilities = capabilities
        self.runner = runner

    @staticmethod
    def can_start(token: str | None) -> bool:
        return isinstance(token, str) and len(token.strip()) >= 20

    def _run_job(self, job: dict[str, Any], lease_token: str) -> None:
        if self.runner is None:
            raise WorkerApiError("没有安装媒体处理模型", code="MODEL_NOT_INSTALLED")
        job_id = str(job.get("id") or "")
        request = job.get("request") if isinstance(job.get("request"), dict) else {}
        stop_heartbeat = threading.Event()

        def keep_lease_alive() -> None:
            while not stop_heartbeat.wait(self.HEARTBEAT_SECONDS):
                try:
                    self.client.heartbeat_job(job_id, lease_token)
                except Exception:
                    # A later heartbeat may recover from a transient network
                    # failure.  The server-side lease recovery remains the
                    # final authority if this worker really goes offline.
                    continue

        heartbeat_thread = threading.Thread(target=keep_lease_alive, name=f"fg-worker-lease-{job_id[:8]}", daemon=True)
        heartbeat_thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix="fg-worker-") as directory:
                input_path = str(Path(directory) / "input.bin")
                output_path = str(Path(directory) / "output.bin")
                Path(input_path).write_bytes(self.client.download_input(job_id, lease_token))
                self.client.progress(job_id, lease_token, 1, "downloading")
                if request.get("maskAssetId"):
                    mask_path = Path(directory) / "mask.png"
                    mask_path.write_bytes(self.client.download_mask(job_id, lease_token))
                    request = {**request, "maskPath": str(mask_path)}
                self.runner(input_path, output_path, request, lambda value, phase=None: self.client.progress(job_id, lease_token, value, phase))
                output = Path(output_path)
                if not output.is_file() or output.stat().st_size <= 0:
                    raise WorkerApiError("媒体处理没有产生输出文件", code="OUTPUT_MISSING")
                total = output.stat().st_size
                digest = hashlib.sha256()
                with output.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(self.CHUNK_BYTES), b""):
                        digest.update(chunk)
                is_video = str(request.get("operation")) in {"video_super_resolution", "watermark_removal"}
                file_name = "result.mp4" if is_video else "result.bin"
                mime_type = "video/mp4" if is_video else "application/octet-stream"
                upload = self.client.init_upload(job_id, lease_token, expected_bytes=total, mime_type=mime_type, file_name=file_name, sha256=digest.hexdigest())
                upload_id = str(upload.get("uploadId") or "")
                if not upload_id:
                    raise WorkerApiError("上传初始化没有返回 uploadId", code="UPLOAD_INIT_INVALID")
                sent = 0
                with output.open("rb") as stream:
                    while sent < total:
                        chunk = stream.read(self.CHUNK_BYTES)
                        if not chunk:
                            break
                        end = sent + len(chunk) - 1
                        self.client.upload_chunk(upload_id, lease_token, start=sent, end=end, total=total, body=chunk)
                        sent = end + 1
                        self.client.progress(job_id, lease_token, min(99, sent * 100 / total), "uploading")
                self.client.complete_upload(upload_id, lease_token, file_name)
        finally:
            stop_heartbeat.set()
            heartbeat_thread.join(timeout=2)

    def run_once(self) -> bool:
        self.client.heartbeat(self.capabilities)
        response = self.client.claim()
        job = response.get("job") if isinstance(response, dict) else None
        lease_token = response.get("leaseToken") if isinstance(response, dict) else None
        if not isinstance(job, dict) or not isinstance(lease_token, str) or not lease_token:
            return False
        job_id = str(job.get("id") or "")
        try:
            self._run_job(job, lease_token)
        except Exception as error:
            operation_retryable = getattr(error, "retryable", None)
            if isinstance(operation_retryable, bool):
                retryable = operation_retryable
            else:
                retryable = not isinstance(error, WorkerApiError) or error.code not in {
                    "MODEL_NOT_INSTALLED", "UNSUPPORTED_BACKEND", "INVALID_MEDIA_JOB", "MODEL_PROFILE_UNSUPPORTED",
                    "INVALID_TARGET_RESOLUTION", "MASK_REQUIRED", "MASK_NOT_FOUND", "OPERATION_UNSUPPORTED",
                }
            try:
                self.client.fail(job_id, lease_token, retryable=retryable, error_code=getattr(error, "code", None) or "WORKER_PROCESSING_FAILED", message=str(error))
            except Exception:
                pass
        return True

    def run_forever(self) -> None:
        if not self.can_start(self.client.token):
            raise ValueError("Worker 尚未配对")
        while True:
            worked = self.run_once()
            if not worked:
                time.sleep(self.POLL_SECONDS)
