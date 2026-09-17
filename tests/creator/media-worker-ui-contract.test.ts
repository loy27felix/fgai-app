import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const service = fs.readFileSync("reference/infinite-canvas/src/services/api/media-worker.ts", "utf8");
const component = fs.readFileSync("reference/infinite-canvas/src/components/canvas/local-worker-status.tsx", "utf8");

test("canvas exposes a platform-specific zero-install installer", () => {
  assert.match(service, /workerInstallerPlatform/);
  assert.match(service, /bootstrap\/installer/);
  assert.match(service, /macos-arm64/);
  assert.match(service, /windows-amd64/);
  assert.match(component, /下载一键安装包/);
  assert.match(component, /不用安装 Python、FFmpeg、PyTorch 或模型/);
});
