type ClipboardTarget = {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
};

// Canvas overlays use data-canvas-no-zoom only to control pointer and wheel
// behavior. They must not suppress a native image paste unless the target is
// actually editable text.
export function shouldIgnoreCanvasClipboardTarget(target: ClipboardTarget | null | undefined) {
    if (!target) return false;
    const tagName = target.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
    return Boolean(target.isContentEditable || target.closest?.("[contenteditable='true']"));
}
