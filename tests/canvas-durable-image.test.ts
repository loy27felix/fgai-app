import assert from "node:assert/strict";
import test from "node:test";

import { findLegacyCreatorImageTask, imageMetadata } from "../reference/infinite-canvas/src/lib/canvas/canvas-node-factory";

test("generated image metadata preserves its creator task and durable asset path", () => {
    const metadata = imageMetadata({
        url: "https://assets.example/signed-result.png",
        width: 1536,
        height: 864,
        bytes: 0,
        mimeType: "image/png",
        creatorTaskId: "image-task-1",
        cloudStoragePath: "user/image-tasks/image-task-1/result.png",
        cloudAssetId: "asset-1",
    });

    assert.equal(metadata.creatorTaskId, "image-task-1");
    assert.equal(metadata.cloudStoragePath, "user/image-tasks/image-task-1/result.png");
    assert.equal(metadata.cloudAssetId, "asset-1");
    assert.equal(metadata.storageKey, undefined);
});

test("a legacy cache-only image recovers only when its prompt and model identify one completed creator task", () => {
    const matching = {
        id: "image-task-1",
        model: "gpt-image-2",
        status: "succeeded" as const,
        request: { prompt: "cinematic fox" },
        resultUrl: "https://assets.example/result.png",
    };
    const duplicate = { ...matching, id: "image-task-2" };

    assert.equal(
        findLegacyCreatorImageTask({ prompt: "cinematic fox", model: "default::gpt-image-2" }, [matching]),
        matching,
    );
    assert.equal(
        findLegacyCreatorImageTask({ prompt: "cinematic fox", model: "default::gpt-image-2" }, [matching, duplicate]),
        undefined,
    );
});
