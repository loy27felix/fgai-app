import assert from "node:assert/strict";
import test from "node:test";
import { validateUploadRange, workerAssetPath, workerTemporaryPath } from "../../lib/local/worker-storage";

test("server derives paths from user and job IDs", () => {
  assert.equal(workerAssetPath("u1", "j1", "result.mp4"), "u1/processing-results/j1/result.mp4");
  assert.equal(workerTemporaryPath("u1", "j1", "upload-1"), "u1/processing-tmp/j1/upload-1.part");
  assert.throws(() => workerAssetPath("u1", "j1", "../other.mp4"), /非法/);
});

test("upload chunks must be contiguous and bounded", () => {
  assert.deepEqual(validateUploadRange({ start: 0, end: 7, total: 8, received: 0 }), { nextReceived: 8 });
  assert.throws(() => validateUploadRange({ start: 4, end: 7, total: 8, received: 0 }), /连续/);
  assert.throws(() => validateUploadRange({ start: 0, end: 8 * 1024 * 1024, total: 8 * 1024 * 1024 + 1, received: 0 }), /大小/);
});

