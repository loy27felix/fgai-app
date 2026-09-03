import assert from "node:assert/strict";
import test from "node:test";

import { appendImageAlternative, imageAlternativeMetadata, readImageAlternatives } from "../reference/infinite-canvas/src/lib/canvas/canvas-image-alternatives";

test("image reruns retain the original result and append a switchable version", () => {
    const initial = {
        content: "https://media.example/image-one.png",
        creatorTaskId: "creator-one",
        storageKey: "images/one.png",
        mimeType: "image/png",
        naturalWidth: 1024,
        naturalHeight: 1024,
    };
    const appended = appendImageAlternative(initial, {
        content: "https://media.example/image-two.png",
        creatorTaskId: "creator-two",
        storageKey: "images/two.png",
        mimeType: "image/png",
        naturalWidth: 1536,
        naturalHeight: 1024,
    }, "attempt-two");

    assert.equal(appended.alternatives.length, 2);
    assert.equal(appended.activeImageAlternativeIndex, 1);
    assert.equal(appended.alternatives[0]?.content, initial.content);
    assert.equal(appended.alternatives[1]?.content, "https://media.example/image-two.png");
    assert.deepEqual(imageAlternativeMetadata(appended.alternatives[1]!), {
        content: "https://media.example/image-two.png",
        storageKey: "images/two.png",
        mimeType: "image/png",
        bytes: undefined,
        naturalWidth: 1536,
        naturalHeight: 1024,
        cloudStoragePath: undefined,
        cloudAssetId: undefined,
        creatorTaskId: "creator-two",
    });
    assert.equal(readImageAlternatives({ imageAlternatives: appended.alternatives }).length, 2);
});
