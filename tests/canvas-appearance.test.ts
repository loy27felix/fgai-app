import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CANVAS_APPEARANCE, normalizeCanvasAppearance } from "../reference/infinite-canvas/src/lib/canvas/canvas-appearance";

test("canvas appearance provides stable defaults for existing projects", () => {
    assert.deepEqual(normalizeCanvasAppearance(), DEFAULT_CANVAS_APPEARANCE);
});

test("canvas appearance keeps only a bounded durable background path and clamps opacity", () => {
    const appearance = normalizeCanvasAppearance({ backgroundImagePath: "creator-assets/workspace/backgrounds/board.png", backgroundImageOpacity: 1.8, gridOpacity: -0.2 });

    assert.equal(appearance.backgroundImagePath, "creator-assets/workspace/backgrounds/board.png");
    assert.equal(appearance.backgroundImageOpacity, 1);
    assert.equal(appearance.gridOpacity, 0);
    assert.equal(normalizeCanvasAppearance({ backgroundImagePath: "x".repeat(1025) }).backgroundImagePath, undefined);
});
