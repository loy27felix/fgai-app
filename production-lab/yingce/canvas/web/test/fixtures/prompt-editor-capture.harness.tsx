import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLSelectElement: dom.HTMLSelectElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, Event: dom.Event, CustomEvent: dom.CustomEvent, getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AppModal } = await import("../../src/components/ui/product/app-modal/app-modal");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { useCanvasKeyboard } = await import("../../src/pages/canvas/use-canvas-keyboard");
afterAll(() => dom.happyDOM.abort());

test("capture focus roundtrip preserves modal and draft", async () => {
    let deselections = 0;
    const noop = () => {};
    function Editor() {
        const [open, setOpen] = useState(true);
        const [draft, setDraft] = useState("原提示词");
        useCanvasKeyboard({ nodesRef: { current: [] }, selectedNodeIdsRef: { current: new Set(["shot"]) }, selectedConnectionId: null,
            setSelectedNodeIds: noop, setSelectedConnectionId: noop, setContextMenu: noop, setShortcutRequestNonce: noop, setInfoNodeId: noop, setCropNodeId: noop, setRegionEditNodeId: noop, setAnnotationNodeId: noop,
            saveCanvasProject: noop, zoomToActualSize: noop, fitCanvasContent: noop, fitCanvasSelection: noop, undoCanvas: noop, redoCanvas: noop, cancelSelectionBox: noop, copySelectedNodes: noop, pasteCopiedNodes: () => false, restoreCopiedNodesFromText: () => false, shouldPreferCopiedNodes: () => false, pasteSystemClipboard: () => false, deleteNodes: noop, deleteConnection: noop, deselectCanvas: () => { deselections++; }, zoomCanvasIn: noop, zoomCanvasOut: noop, focusMode: false, exitFocusMode: noop, toggleFocusMode: noop, onOpenSearch: noop, beginBatchConnection: noop });
        return <AppModal stablePromptEditor title="视频提示词 · 完整编辑" open={open} footer={null} onCancel={() => setOpen(false)}><CanvasResourceMentionTextarea value={draft} references={[]} onChange={setDraft} aria-label="提示词" /></AppModal>;
    }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Editor />));
        const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="提示词"]')!;
        expect(editor).not.toBeNull();
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "手工修改的提示词");
            editor.dispatchEvent(new dom.Event("input", { bubbles: true }));
            editor.blur(); window.dispatchEvent(new dom.Event("blur"));
            document.dispatchEvent(new dom.Event("visibilitychange"));
            document.body.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            window.dispatchEvent(new dom.Event("focus"));
        });
        expect(deselections).toBe(0);
        expect(document.querySelector('[data-canvas-prompt-editor-open="true"]')).not.toBeNull();
        expect(editor.value).toBe("手工修改的提示词");
        await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
        expect(document.querySelector('[data-canvas-prompt-editor-open="true"]')).toBeNull();
        await act(async () => document.body.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(deselections).toBe(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
});
