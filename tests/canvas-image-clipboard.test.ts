import assert from "node:assert/strict";
import test from "node:test";

import { copyCanvasImageToClipboard } from "../reference/infinite-canvas/src/lib/canvas/canvas-image-clipboard";

type ClipboardPayload = Blob | Promise<Blob>;

test("copying a canvas image writes image data to the system clipboard", async () => {
  const writes: Array<Record<string, ClipboardPayload>> = [];
  class MockClipboardItem {
    readonly data: Record<string, ClipboardPayload>;
    constructor(data: Record<string, ClipboardPayload>) {
      this.data = data;
    }
  }

  await copyCanvasImageToClipboard("https://assets.example/frame.png", {
    fetcher: async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }),
    clipboard: { write: async (items) => { writes.push((items[0] as MockClipboardItem).data); } },
    ClipboardItem: MockClipboardItem,
  });

  assert.equal(writes.length, 1);
  const png = await writes[0]["image/png"];
  assert.equal(png?.type, "image/png");
  assert.ok((png?.size || 0) > 0);
});

test("copying still attempts ClipboardItem when an embedded browser reports an insecure context", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const writes: unknown[] = [];
  class MockClipboardItem {
    constructor(_data: Record<string, ClipboardPayload>) {}
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

test("copying starts the native clipboard write before source bytes finish loading", async () => {
  let resolveResponse: (response: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const events: string[] = [];

  class MockClipboardItem {
    constructor(readonly data: Record<string, ClipboardPayload>) {}
  }

  const copying = copyCanvasImageToClipboard("https://assets.example/frame.png", {
    fetcher: () => {
      events.push("fetch");
      return response;
    },
    clipboard: {
      write: async (items) => {
        events.push("write");
        const image = await (items[0] as MockClipboardItem).data["image/png"];
        assert.equal(image.type, "image/png");
      },
    },
    ClipboardItem: MockClipboardItem,
  });

  assert.deepEqual(events, ["fetch", "write"]);
  resolveResponse(new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }));
  await copying;
});

test("copying fails clearly when the browser cannot write an image clipboard item", async () => {
  await assert.rejects(() => copyCanvasImageToClipboard("https://assets.example/frame.png", {
    fetcher: async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 }),
  }), /当前浏览器不支持直接复制图片/);
});
