import assert from "node:assert/strict";
import test from "node:test";

import { onCanvasEvent } from "../reference/infinite-canvas/src/lib/canvas/canvas-event-bus";
import { requestCanvasGenerationConfirmation } from "../reference/infinite-canvas/src/lib/canvas/generation-confirmation";

const request = {
    nodeId: "node-1",
    nodeTitle: "示例节点",
    mode: "image" as const,
    model: "gpt-image-2",
    prompt: "一只在月球上行走的狐狸",
};

test("generation starts immediately when no confirmation plugin is enabled", async () => {
    assert.equal(await requestCanvasGenerationConfirmation(request), true);
});

test("an enabled behaviour plugin can cancel a generation before the provider call", async () => {
    const stop = onCanvasEvent("canvas:generation-confirmation", (payload) => {
        const confirmation = payload as { intercepted: boolean; resolve: (approved: boolean) => void };
        confirmation.intercepted = true;
        confirmation.resolve(false);
    });
    try {
        assert.equal(await requestCanvasGenerationConfirmation(request), false);
    } finally {
        stop();
    }
});
