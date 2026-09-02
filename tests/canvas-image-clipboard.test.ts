import assert from "node:assert/strict";
import test from "node:test";

import {
  copyCanvasImageToClipboard,
  isCanvasNativeImageCopyInFlight,
  runCanvasNativeImageClipboardCopy,
} from "../reference/infinite-canvas/src/lib/canvas/canvas-image-clipboard";

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

test("copying still attempts ClipboardItem when an embedded browser reports an insecure context", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const writes: unknown[] = [];
  class MockClipboardItem {
    constructor(_data: Record<string, Blob>) {}
  }

  Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: false } });
  try {
    await copyCanvasImageToClipboard("https://assets.example/frame.png", {
      fetcher: async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }),
      clipboard: { write: async (items) => { writes.push(...items); } },
      ClipboardItem: MockClipboardItem,
    });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.equal(writes.length, 1);
});

test("copying falls back to a legacy native copy operation when ClipboardItem is unavailable", async () => {
  let copiedBytes = 0;

  await copyCanvasImageToClipboard("https://assets.example/frame.png", {
    fetcher: async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }),
    legacyCopy: async (blob) => { copiedBytes = blob.size; },
  });

  assert.equal(copiedBytes, "image-bytes".length);
});

test("legacy image copying marks only its native copy event as external clipboard content", () => {
  assert.equal(isCanvasNativeImageCopyInFlight(), false);

  let wasMarkedDuringCopy = false;
  const result = runCanvasNativeImageClipboardCopy(() => {
    wasMarkedDuringCopy = isCanvasNativeImageCopyInFlight();
    return "copied";
  });

  assert.equal(result, "copied");
  assert.equal(wasMarkedDuringCopy, true);
  assert.equal(isCanvasNativeImageCopyInFlight(), false);
});
