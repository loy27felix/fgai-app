import assert from "node:assert/strict";
import test from "node:test";

import { shouldReportMissingVideoBackup } from "../../reference/infinite-canvas/src/lib/canvas/canvas-video-recovery";
import { CanvasNodeType, type CanvasNodeData } from "../../reference/infinite-canvas/src/types/canvas";

function videoNode(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return {
        id: "video-1",
        type: CanvasNodeType.Video,
        title: "视频",
        position: { x: 0, y: 0 },
        width: 680,
        height: 382,
        metadata,
    };
}

test("blank video drafts are not treated as an invalid local media copy after refresh", () => {
    assert.equal(shouldReportMissingVideoBackup(videoNode({ content: "", status: "idle" })), false);
    assert.equal(shouldReportMissingVideoBackup(videoNode({ content: "", status: "error", errorDetails: "模型请求失败" })), false);
});

test("only completed video outputs without a recoverable source show the local-copy error", () => {
    assert.equal(shouldReportMissingVideoBackup(videoNode({ content: "", status: "success" })), true);
    assert.equal(shouldReportMissingVideoBackup(videoNode({ content: "", status: "success", creatorTaskId: "creator-task" })), false);
    assert.equal(shouldReportMissingVideoBackup(videoNode({ content: "https://example.com/video.mp4", status: "success" })), false);
});
