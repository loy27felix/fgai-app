import assert from "node:assert/strict";
import test from "node:test";
import { validateMediaJobInput, workerSupportsJob } from "../../lib/creator/media-processing";

test("video super-resolution requires an owned video asset and a supported target", () => {
  assert.deepEqual(validateMediaJobInput({
    operation: "video_super_resolution",
    sourceAssetId: " asset-1 ",
    targetResolution: "1080p",
    modelProfile: "basicvsrpp-quality",
    idempotencyKey: "job-1",
  }), {
    operation: "video_super_resolution",
    sourceAssetId: "asset-1",
    maskAssetId: null,
    targetResolution: "1080p",
    modelProfile: "basicvsrpp-quality",
    idempotencyKey: "job-1",
  });
});

test("watermark removal refuses a missing mask", () => {
  assert.throws(() => validateMediaJobInput({
    operation: "watermark_removal",
    sourceAssetId: "asset-1",
    targetResolution: null,
    modelProfile: "propainter-mask",
    idempotencyKey: "job-2",
  }), /遮罩/);
});

test("worker capability matching is explicit", () => {
  assert.equal(workerSupportsJob({
    operation: "video_super_resolution",
    modelProfile: "basicvsrpp-quality",
    targetResolution: "1080p",
  }, {
    operations: ["video_super_resolution"],
    backends: ["cuda"],
    modelProfiles: ["basicvsrpp-quality"],
    maxInputBytes: 2_000_000_000,
    maxOutputPixels: 8_294_400,
  }), true);
});

test("missing capability limits never mean unlimited", () => {
  assert.equal(workerSupportsJob({
    operation: "video_super_resolution",
    modelProfile: "basicvsrpp-quality",
    targetResolution: "4k",
  }, {
    operations: ["video_super_resolution"],
    backends: ["mps"],
    modelProfiles: ["basicvsrpp-quality"],
    maxInputBytes: 1,
    maxOutputPixels: 1,
  }), false);
});

