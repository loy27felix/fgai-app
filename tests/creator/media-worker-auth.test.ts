import assert from "node:assert/strict";
import test from "node:test";
import {
  hashWorkerToken,
  normalizeWorkerCapabilities,
  pairingCodeExpiry,
  timingSafeTokenMatch,
  workerTokenExpiry,
} from "../../lib/creator/media-worker-auth";

test("worker token hashing never returns the original token", () => {
  const token = "fgw_test_token_that_is_long_enough";
  assert.notEqual(hashWorkerToken(token), token);
  assert.equal(timingSafeTokenMatch(token, hashWorkerToken(token)), true);
  assert.equal(timingSafeTokenMatch("fgw_other_token_that_is_long_enough", hashWorkerToken(token)), false);
});

test("pairing codes and tokens have bounded lifetimes", () => {
  const now = Date.parse("2026-09-15T00:00:00Z");
  assert.equal(pairingCodeExpiry(now).getTime() - now, 10 * 60 * 1000);
  assert.equal(workerTokenExpiry(now).getTime() - now, 90 * 24 * 60 * 60 * 1000);
});

test("capability normalization drops unsupported backends and operations", () => {
  assert.deepEqual(normalizeWorkerCapabilities({
    operations: ["video_super_resolution", "unknown"],
    backends: ["cuda", "webgpu"],
    modelProfiles: ["basicvsrpp-quality"],
    maxInputBytes: 1024,
    maxOutputPixels: 2048,
  }), {
    operations: ["video_super_resolution"],
    backends: ["cuda"],
    modelProfiles: ["basicvsrpp-quality"],
    maxInputBytes: 1024,
    maxOutputPixels: 2048,
  });
});

