import assert from "node:assert/strict";
import test from "node:test";

import { getCanvasEdgeAutoPanDelta } from "../reference/infinite-canvas/src/lib/canvas/canvas-edge-auto-pan";

const bounds = { left: 100, top: 80, right: 1100, bottom: 680 };

test("edge auto-pan is idle away from the canvas boundary", () => {
    assert.deepEqual(getCanvasEdgeAutoPanDelta({ x: 600, y: 360 }, bounds), { x: 0, y: 0 });
    assert.deepEqual(getCanvasEdgeAutoPanDelta({ x: 50, y: 360 }, bounds), { x: 0, y: 0 });
});

test("edge auto-pan follows the dragged item toward every canvas edge", () => {
    const left = getCanvasEdgeAutoPanDelta({ x: 108, y: 360 }, bounds);
    const right = getCanvasEdgeAutoPanDelta({ x: 1092, y: 360 }, bounds);
    const top = getCanvasEdgeAutoPanDelta({ x: 600, y: 88 }, bounds);
    const bottom = getCanvasEdgeAutoPanDelta({ x: 600, y: 672 }, bounds);

    assert.ok(left.x > 0 && left.y === 0);
    assert.ok(right.x < 0 && right.y === 0);
    assert.ok(top.y > 0 && top.x === 0);
    assert.ok(bottom.y < 0 && bottom.x === 0);
});
