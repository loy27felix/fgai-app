import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectedReferenceShelf } from "../src/components/canvas/canvas-node-prompt-references";
import { canvasThemes } from "../src/lib/canvas-theme";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

const references: CanvasResourceReference[] = ["a", "b"].map((id, index) => ({ id, nodeId: id, kind: "image", active: true, label: `图片${index + 1}`, title: id, previewUrl: `https://example.com/${id}.png` }));
test("the entire reference card can be dragged while its thumbnail never starts a browser image drag", () => {
    const html = renderToStaticMarkup(<ConnectedReferenceShelf references={references} theme={canvasThemes.dark} onInsert={() => {}} onReorder={() => {}} />);
    expect(html.match(/data-reference-chip="true"[^>]*draggable="true"/g)).toHaveLength(2);
    expect(html.match(/<img[^>]*draggable="false"/g)).toHaveLength(2);
    expect(html).toContain("将 图片1 后移");
    expect(html).toContain("将 图片2 前移");
});
test("read-only reference shelves cannot reorder", () => {
    const html = renderToStaticMarkup(<ConnectedReferenceShelf references={references} theme={canvasThemes.dark} onInsert={() => {}} />);
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("前移");
});
