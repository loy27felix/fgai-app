import assert from "node:assert/strict";
import test from "node:test";

import { copyCanvasImageToClipboard } from "../reference/infinite-canvas/src/lib/canvas/canvas-image-clipboard";

test("copying a canvas image writes image data to the system clipboard", async () => {
  const writes: Array<Record<string, Blob>> = [];
  class MockClipboardItem {
    readonly data: Record<string, Blob>;
    constructor(data: Record<string, Blob>) {
      this.data = data;
    }
  }

  await copyCanvasImageToClipboard("https://assets.example/frame.png", {
    fetcher: async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }),
    clipboard: { write: async (items) => { writes.push((items[0] as MockClipboardItem).data); } },
    ClipboardItem: MockClipboardItem,
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0]["image/png"]?.type, "image/png");
  assert.ok((writes[0]["image/png"]?.size || 0) > 0);
});
