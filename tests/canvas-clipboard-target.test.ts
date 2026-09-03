import assert from "node:assert/strict";
import test from "node:test";

import { shouldIgnoreCanvasClipboardTarget } from "../reference/infinite-canvas/src/lib/canvas/canvas-clipboard-target";

test("clipboard images remain eligible when a canvas overlay is the paste target", () => {
    const overlay = {
        tagName: "DIV",
        closest: (selector: string) => (selector === "[data-canvas-no-zoom]" ? overlay : null),
    };

    assert.equal(shouldIgnoreCanvasClipboardTarget(overlay), false);
});

test("clipboard handling stays inside text and rich-text editing controls", () => {
    assert.equal(shouldIgnoreCanvasClipboardTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(shouldIgnoreCanvasClipboardTarget({ tagName: "INPUT" }), true);
    assert.equal(
        shouldIgnoreCanvasClipboardTarget({
            tagName: "DIV",
            closest: (selector: string) => (selector === "[contenteditable='true']" ? {} : null),
        }),
        true,
    );
});
