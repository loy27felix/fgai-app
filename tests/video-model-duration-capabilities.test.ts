import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSeedanceDuration, seedanceDurationOptions } from "../reference/infinite-canvas/src/lib/seedance-video";

test("video duration options include the three-second HappyHorse capability", () => {
    assert.ok(seedanceDurationOptions.includes(3));
    assert.equal(normalizeSeedanceDuration("3", "happyhorse-1.1-i2v"), 3);
});

test("duration normalization remains model-bounded instead of exposing a global 4–30 range", () => {
    assert.equal(normalizeSeedanceDuration("30", "dreamina-seedance-2-5"), 30);
    assert.equal(normalizeSeedanceDuration("30", "MiniMax-H3"), 15);
    assert.equal(normalizeSeedanceDuration("2", "doubao-seedance-2-0"), 4);
});
