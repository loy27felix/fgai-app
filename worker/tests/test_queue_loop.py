from fg_worker.queue_loop import WorkerLoop


def test_loop_does_not_claim_when_token_is_missing():
    assert WorkerLoop.can_start(token=None) is False
    assert WorkerLoop.can_start(token="short") is False
    assert WorkerLoop.can_start(token="fgw_" + "x" * 32) is True


class FakeClient:
    token = "fgw_" + "x" * 32

    def __init__(self):
        self.calls = []

    def download_input(self, job_id, lease_token):
        self.calls.append(("input", job_id, lease_token))
        return b"video"

    def download_mask(self, job_id, lease_token):
        self.calls.append(("mask", job_id, lease_token))
        return b"mask"

    def progress(self, job_id, lease_token, progress, phase=None):
        self.calls.append(("progress", phase))

    def heartbeat_job(self, job_id, lease_token):
        self.calls.append(("job-heartbeat", job_id))
        return {"job": {"id": job_id}}

    def init_upload(self, *args, **kwargs):
        self.calls.append(("init-upload", kwargs["mime_type"], kwargs["file_name"]))
        return {"uploadId": "upload-1"}

    def upload_chunk(self, *args, **kwargs):
        self.calls.append(("upload-chunk", kwargs["start"], kwargs["end"]))

    def complete_upload(self, *args, **kwargs):
        self.calls.append(("complete-upload", kwargs.get("file_name") or args[-1]))
        return {"result": {"assetId": "asset-1"}}


def test_job_downloads_mask_and_keeps_video_output_type():
    client = FakeClient()
    seen = {}

    def runner(input_path, output_path, request, progress):
        from pathlib import Path

        seen.update(request)
        assert Path(input_path).read_bytes() == b"video"
        assert Path(request["maskPath"]).read_bytes() == b"mask"
        Path(output_path).write_bytes(b"result")
        progress(50, "processing")

    loop = WorkerLoop(client, {}, runner=runner)
    loop._run_job({"id": "job-1", "request": {"operation": "watermark_removal", "maskAssetId": "mask-1"}}, "lease-1")

    assert seen["operation"] == "watermark_removal"
    assert any(call[0] == "mask" for call in client.calls)
    assert ("init-upload", "video/mp4", "result.mp4") in client.calls
    assert ("complete-upload", "result.mp4") in client.calls
