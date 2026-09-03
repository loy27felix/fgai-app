import assert from "node:assert/strict";
import test from "node:test";

import { appendVideoAlternative, readVideoAlternatives, videoAlternativeAssetTitle, videoAlternativeFileName, videoAlternativeMetadata } from "../reference/infinite-canvas/src/lib/canvas/canvas-video-alternatives";

test("video reruns append a selectable version instead of replacing the original result", () => {
    const initial = {
        content: "https://media.example/video-one.mp4",
        creatorTaskId: "creator-one",
        storageKey: "videos/one.mp4",
        mimeType: "video/mp4",
    };
    const appended = appendVideoAlternative(initial, {
        content: "https://media.example/video-two.mp4",
        storageKey: "videos/two.mp4",
        mimeType: "video/mp4",
    }, "attempt-two");

    assert.equal(appended.alternatives.length, 2);
    assert.equal(appended.activeVideoAlternativeIndex, 1);
    assert.equal(appended.alternatives[0]?.content, initial.content);
    assert.equal(appended.alternatives[1]?.content, "https://media.example/video-two.mp4");
    assert.equal(appended.alternatives[1]?.id, "attempt-two");
    const restored = videoAlternativeMetadata(appended.alternatives[0]!);
    assert.equal(restored.content, initial.content);
    assert.equal(restored.creatorTaskId, initial.creatorTaskId);
    assert.equal(restored.storageKey, initial.storageKey);
    assert.equal(restored.mimeType, initial.mimeType);
});

test("video caching updates the current version rather than adding a duplicate card", () => {
    const current = {
        content: "https://media.example/video.mp4",
        creatorTaskId: "creator-one",
        mimeType: "video/mp4",
    };
    const first = appendVideoAlternative(undefined, current);
    const cached = appendVideoAlternative(
        { ...current, videoAlternatives: first.alternatives, activeVideoAlternativeIndex: first.activeVideoAlternativeIndex },
        { ...current, content: "/api/media/videos/one.mp4", storageKey: "videos/one.mp4" },
    );

    assert.equal(cached.alternatives.length, 1);
    assert.equal(cached.alternatives[0]?.content, "/api/media/videos/one.mp4");
    assert.equal(readVideoAlternatives({ videoAlternatives: cached.alternatives })[0]?.storageKey, "videos/one.mp4");
});

test("task recovery does not duplicate a video that was already written by the live run", () => {
    const liveRun = appendVideoAlternative(
        { content: "https://media.example/video-one.mp4", creatorTaskId: "creator-one", mimeType: "video/mp4" },
        { content: "https://media.example/video-two.mp4", creatorTaskId: "creator-two", mimeType: "video/mp4" },
        "live-attempt-id",
    );
    const recovered = appendVideoAlternative(
        {
            content: "https://media.example/video-two.mp4",
            creatorTaskId: "creator-two",
            mimeType: "video/mp4",
            videoAlternatives: liveRun.alternatives,
        },
        { content: "https://media.example/video-two.mp4", creatorTaskId: "creator-two", mimeType: "video/mp4" },
    );

    assert.equal(recovered.alternatives.length, 2);
    assert.equal(recovered.activeVideoAlternativeIndex, 1);
    assert.equal(recovered.alternatives[1]?.id, "live-attempt-id");
});

test("video alternatives receive a readable active-version name when saved or downloaded", () => {
    const metadata = {
        activeVideoAlternativeIndex: 1,
        videoAlternatives: [
            { id: "first", content: "https://media.example/first.mp4", mimeType: "video/mp4" },
            { id: "second", content: "https://media.example/second.webm", mimeType: "video/webm" },
        ],
    };

    assert.equal(videoAlternativeAssetTitle("贝瓦吉他开箱", metadata), "贝瓦吉他开箱 · V02");
    assert.equal(videoAlternativeFileName("贝瓦吉他开箱", metadata), "贝瓦吉他开箱-v02.webm");
});
