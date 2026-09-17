import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const bootstrap = fs.readFileSync("lib/creator/media-worker-bootstrap.ts", "utf8");
const manifestRoute = fs.readFileSync("app/api/creator/worker/bootstrap/manifest/route.ts", "utf8");
const artifactRoute = fs.readFileSync("app/api/creator/worker/bootstrap/artifacts/[id]/route.ts", "utf8");
const installerRoute = fs.readFileSync("app/api/creator/worker/bootstrap/installer/route.ts", "utf8");

test("worker bootstrap validates hashes and never exposes NAS paths", () => {
  assert.match(bootstrap, /hashWorkerToken/);
  assert.match(bootstrap, /sha256/);
  assert.match(bootstrap, /downloadPath/);
  assert.match(bootstrap, /assertActivePairingCode/);
  assert.match(artifactRoute, /localFileSize/);
  assert.doesNotMatch(manifestRoute, /artifact\.bucket/);
  assert.doesNotMatch(manifestRoute, /artifact\.path/);
});

test("bootstrap routes are gated and redirect through short-lived signed URLs", () => {
  for (const source of [manifestRoute, artifactRoute, installerRoute]) {
    assert.match(source, /MEDIA_WORKER_DISABLED/);
  }
  assert.match(artifactRoute, /createSignedUrl\(artifact\.path, 10 \* 60\)/);
  assert.match(installerRoute, /createSignedUrl\(installer\.path, 10 \* 60\)/);
});
