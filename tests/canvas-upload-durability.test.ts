import assert from "node:assert/strict";
import test from "node:test";

import { isFailedCanvasMediaUpload, isPendingCanvasMediaUpload } from "@/reference/infinite-canvas/src/lib/canvas/canvas-upload-durability";
import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

function mediaNode(type: CanvasNodeType, metadata: CanvasNodeData["metadata"]): CanvasNodeData {
  return {
    id: "node-1",
    type,
    title: "asset",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
  };
}

test("every unpersisted media upload is held out of cloud canvas saves", () => {
    assert.equal(isPendingCanvasMediaUpload(mediaNode(CanvasNodeType.Image, { durableUploadPending: true })), true);
    assert.equal(isPendingCanvasMediaUpload(mediaNode(CanvasNodeType.Video, { durableUploadPending: true })), true);
    assert.equal(isPendingCanvasMediaUpload(mediaNode(CanvasNodeType.Audio, { durableUploadPending: true })), true);
  assert.equal(isPendingCanvasMediaUpload(mediaNode(CanvasNodeType.Image, { cloudStoragePath: "user/canvas-assets/image.png" })), false);
});

test("a failed durable upload is never offered a generation retry", () => {
    assert.equal(isFailedCanvasMediaUpload(mediaNode(CanvasNodeType.Video, { durableUploadFailed: true })), true);
    assert.equal(isFailedCanvasMediaUpload(mediaNode(CanvasNodeType.Image, { durableUploadFailed: true })), true);
    assert.equal(isFailedCanvasMediaUpload(mediaNode(CanvasNodeType.Audio, { durableUploadFailed: true })), true);
  assert.equal(isFailedCanvasMediaUpload(mediaNode(CanvasNodeType.Text, { durableUploadFailed: true })), false);
});
