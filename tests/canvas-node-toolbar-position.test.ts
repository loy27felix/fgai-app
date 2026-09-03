import assert from "node:assert/strict";
import test from "node:test";

import { getNodeToolbarTop } from "../reference/infinite-canvas/src/lib/canvas/canvas-node-toolbar-position";

test("node toolbar clears the editable title at the normal canvas scale", () => {
    const nodeTop = 240;
    const titleTop = nodeTop - 28;

    assert.equal(getNodeToolbarTop(nodeTop, 1), titleTop - 8);
});

test("node toolbar keeps the same title clearance after zooming the canvas", () => {
    const nodeTop = 240;

    assert.equal(getNodeToolbarTop(nodeTop, 0.5), nodeTop - 28 * 0.5 - 8);
    assert.equal(getNodeToolbarTop(nodeTop, 2), nodeTop - 28 * 2 - 8);
});
