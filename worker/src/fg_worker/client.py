from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class WorkerApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class WorkerClient:
    base_url: str
    token: str
    timeout: float = 30.0

    def __post_init__(self):
        self.base_url = self.base_url.rstrip("/")

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"accept": "application/json", "authorization": f"Bearer {self.token}"}
        if extra:
            headers.update(extra)
        return headers

    def request(self, method: str, path: str, *, payload: dict[str, Any] | None = None, body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
        url = self.base_url + "/" + path.lstrip("/")
        request_headers = self._headers(headers)
        request_body = body
        if payload is not None:
            request_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("content-type", "application/json")
        try:
            import httpx  # type: ignore

            with httpx.Client(timeout=self.timeout) as client:
                response = client.request(method, url, content=request_body, headers=request_headers)
                return response.status_code, dict(response.headers), response.content
        except ImportError:
            req = urllib.request.Request(url, data=request_body, headers=request_headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:  # noqa: S310 - base URL is operator-configured
                    return int(response.status), dict(response.headers.items()), response.read()
            except urllib.error.HTTPError as error:
                return int(error.code), dict(error.headers.items()), error.read()
            except urllib.error.URLError as error:
                raise WorkerApiError(f"Worker API network error: {error.reason}") from error
        except Exception as error:
            if hasattr(error, "response") and getattr(error, "response", None) is not None:
                response = error.response
                return int(response.status_code), dict(response.headers), response.content
            raise WorkerApiError(f"Worker API request failed: {error}") from error

    @staticmethod
    def _json(status: int, body: bytes) -> dict[str, Any]:
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WorkerApiError("Worker API returned invalid JSON", status=status) from error
        if not isinstance(value, dict):
            raise WorkerApiError("Worker API returned an invalid response", status=status)
        if status >= 400:
            raise WorkerApiError(str(value.get("error") or "Worker API request failed"), status=status, code=value.get("code"))
        return value

    def register(self, code: str, capabilities: dict[str, Any], *, name: str, platform: str, architecture: str) -> dict[str, Any]:
        status, _headers, body = self.request("POST", "/api/creator/worker/register", payload={"code": code, "capabilities": capabilities, "name": name, "platform": platform, "architecture": architecture})
        return self._json(status, body)

    def heartbeat(self, capabilities: dict[str, Any]) -> dict[str, Any]:
        status, _headers, body = self.request("POST", "/api/creator/worker/heartbeat", payload={"capabilities": capabilities})
        return self._json(status, body)

    def claim(self) -> dict[str, Any]:
        status, _headers, body = self.request("POST", "/api/creator/worker/jobs/claim", payload={})
        return self._json(status, body)

    def download_input(self, job_id: str, lease_token: str) -> bytes:
        status, _headers, body = self.request("GET", f"/api/creator/worker/jobs/{job_id}/input", headers={"x-fg-media-lease-token": lease_token})
        if status >= 400:
            raise WorkerApiError("读取媒体输入失败", status=status)
        return body

    def download_mask(self, job_id: str, lease_token: str) -> bytes:
        status, _headers, body = self.request("GET", f"/api/creator/worker/jobs/{job_id}/mask", headers={"x-fg-media-lease-token": lease_token})
        if status >= 400:
            raise WorkerApiError("读取去水印遮罩失败", status=status)
        return body

    def heartbeat_job(self, job_id: str, lease_token: str) -> dict[str, Any]:
        status, _headers, body = self.request("POST", f"/api/creator/worker/jobs/{job_id}/heartbeat", payload={"leaseToken": lease_token})
        return self._json(status, body)

    def init_upload(self, job_id: str, lease_token: str, *, expected_bytes: int, mime_type: str, file_name: str, sha256: str | None) -> dict[str, Any]:
        status, _headers, body = self.request("POST", f"/api/creator/worker/jobs/{job_id}/output/init", payload={"expectedBytes": expected_bytes, "mimeType": mime_type, "fileName": file_name, "sha256": sha256}, headers={"x-fg-media-lease-token": lease_token})
        return self._json(status, body)

    def upload_chunk(self, upload_id: str, lease_token: str, *, start: int, end: int, total: int, body: bytes) -> dict[str, Any]:
        status, _headers, response_body = self.request("PATCH", f"/api/creator/worker/uploads/{upload_id}", body=body, headers={"content-range": f"bytes {start}-{end}/{total}", "content-type": "application/octet-stream", "x-fg-media-lease-token": lease_token})
        return self._json(status, response_body)

    def complete_upload(self, upload_id: str, lease_token: str, file_name: str) -> dict[str, Any]:
        status, _headers, body = self.request("POST", f"/api/creator/worker/uploads/{upload_id}/complete", payload={"fileName": file_name}, headers={"x-fg-media-lease-token": lease_token})
        return self._json(status, body)

    def progress(self, job_id: str, lease_token: str, progress: float, phase: str | None = None) -> dict[str, Any]:
        status, _headers, body = self.request("POST", f"/api/creator/worker/jobs/{job_id}/progress", payload={"leaseToken": lease_token, "progress": progress, "phase": phase})
        return self._json(status, body)

    def fail(self, job_id: str, lease_token: str, *, retryable: bool, error_code: str, message: str) -> dict[str, Any]:
        status, _headers, body = self.request("POST", f"/api/creator/worker/jobs/{job_id}/fail", payload={"leaseToken": lease_token, "retryable": retryable, "errorCode": error_code, "message": message})
        return self._json(status, body)
