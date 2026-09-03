import assert from "node:assert/strict";
import test from "node:test";

import { shouldReportMissingImageBackup } from "../reference/infinite-canvas/src/lib/canvas/canvas-image-recovery";
import { CanvasNodeType, type CanvasNodeData } from "../reference/infinite-canvas/src/types/canvas";

const imageNode = (metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({
    id: "image-node",
    type: CanvasNodeType.Image,
    title: "图片",
    position: { x: 0, y: 0 },
    width: 320,
    height: 320,
    metadata,
});

test("an intentionally empty image node remains empty after a page restore", () => {
    assert.equal(shouldReportMissingImageBackup(imageNode({ status: "idle" })), false);
    assert.equal(shouldReportMissingImageBackup(imageNode(undefined)), false);
});

test("a completed image with no recoverable content is still reported as unavailable", () => {
    assert.equal(shouldReportMissingImageBackup(imageNode({ status: "success", storageKey: "image:missing" })), true);
    assert.equal(shouldReportMissingImageBackup(imageNode({ status: "success" })), true);
});
