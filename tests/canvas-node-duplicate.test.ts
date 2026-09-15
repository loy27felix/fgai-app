import assert from "node:assert/strict";
import test from "node:test";

import { cloneCanvasNodeForDuplicate } from "../reference/infinite-canvas/src/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../reference/infinite-canvas/src/types/canvas";

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 10, y: 20 }, width: 320, height: 220, metadata };
}

test("duplicating a video keeps reference nodes in place and reconnects only the new target", () => {
    const image1 = node("image-1", CanvasNodeType.Image, { content: "https://assets.example/one.png" });
    const image2 = node("image-2", CanvasNodeType.Image, { content: "https://assets.example/two.png" });
    const video = node("video", CanvasNodeType.Video, {
        content: "https://assets.example/video.mp4",
        status: "success",
        referenceLabels: { "image-1": "图片1", "image-2": "图片2" },
        groupId: "source-group",
        batchRootId: "batch-root",
        generationAttemptId: "stale-attempt",
        creatorTaskId: "creator-task-1",
    });
    const downstream = node("downstream", CanvasNodeType.Video);
    const connections: CanvasConnection[] = [
        { id: "image-1-video", fromNodeId: image1.id, toNodeId: video.id },
        { id: "image-2-video", fromNodeId: image2.id, toNodeId: video.id },
        { id: "video-downstream", fromNodeId: video.id, toNodeId: downstream.id },
    ];

    const result = cloneCanvasNodeForDuplicate(video, "video-copy", [image1, image2, video, downstream], connections);

    assert.equal(result.node.id, "video-copy");
    assert.deepEqual(result.node.position, { x: 58, y: 68 });
    assert.equal(result.node.metadata?.creatorTaskId, "creator-task-1");
    assert.equal(result.node.metadata?.generationAttemptId, undefined);
    assert.equal(result.node.metadata?.groupId, undefined);
    assert.equal(result.node.metadata?.batchRootId, undefined);
    assert.notEqual(result.node.metadata?.referenceLabels, video.metadata?.referenceLabels);
    assert.deepEqual(result.node.metadata?.referenceLabels, { "image-1": "图片1", "image-2": "图片2" });
    assert.deepEqual(result.connections, [
        { fromNodeId: "image-1", toNodeId: "video-copy" },
        { fromNodeId: "image-2", toNodeId: "video-copy" },
    ]);
});
test("duplicating a configured generator preserves its source-to-config link without copying downstream nodes", () => {
    const image = node("image", CanvasNodeType.Image, { content: "https://assets.example/image.png" });
    const config = node("config", CanvasNodeType.Config);
    const video = node("video", CanvasNodeType.Video, { prompt: "use the reference" });
    const output = node("output", CanvasNodeType.Image);
    const connections: CanvasConnection[] = [
        { id: "image-config", fromNodeId: image.id, toNodeId: config.id },
        { id: "video-config", fromNodeId: video.id, toNodeId: config.id },
        { id: "video-output", fromNodeId: video.id, toNodeId: output.id },
    ];

    const result = cloneCanvasNodeForDuplicate(video, "video-copy", [image, config, video, output], connections);

    assert.deepEqual(result.connections, [{ fromNodeId: "video-copy", toNodeId: "config" }]);
});
