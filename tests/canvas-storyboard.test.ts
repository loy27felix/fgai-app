import assert from "node:assert/strict";
import test from "node:test";

import { buildAngleLabel, buildAnglePrompt } from "../reference/infinite-canvas/src/lib/canvas/canvas-generation-helpers";

test("nine-grid storyboard generation uses one consistent reference-sheet prompt", () => {
    const params = { horizontalAngle: 0, pitchAngle: 0, cameraDistance: 5, wideAngle: false, mode: "storyboard" as const };

    assert.equal(buildAngleLabel(params), "AI 九宫格分镜");
    assert.match(buildAnglePrompt(params), /严格 3×3 九格/);
    assert.match(buildAnglePrompt(params), /保持同一主体/);
    assert.match(buildAnglePrompt(params), /不要文字/);
});
