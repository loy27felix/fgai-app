type ClipboardItemConstructor = new (items: Record<string, Blob>) => unknown;

type CanvasImageClipboardDependencies = {
    fetcher?: (input: RequestInfo | URL) => Promise<Response>;
    clipboard?: { write: (items: unknown[]) => Promise<void> };
    ClipboardItem?: ClipboardItemConstructor;
    legacyCopy?: (blob: Blob) => Promise<void>;
};

/**
 * Writes the actual image bytes to the system clipboard.  Canvas graph copy
 * deliberately stays separate, so Ctrl/Cmd+C can keep its node-copy behavior.
 */
export async function copyCanvasImageToClipboard(source: string, dependencies: CanvasImageClipboardDependencies = {}) {
    const clipboard = dependencies.clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
    const ClipboardItemClass = dependencies.ClipboardItem ?? (typeof window !== "undefined" ? window.ClipboardItem : undefined);

    const response = await (dependencies.fetcher ?? fetch)(source);
    if (!response.ok) throw new Error("无法读取图片数据，请刷新后重试");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) throw new Error("图片数据无效，无法复制");

    const png = blob.type === "image/png" ? blob : await renderClipboardPng(blob);
    let clipboardError: unknown;
    if (clipboard && ClipboardItemClass) {
        try {
            const clipboardWriter = clipboard as { write: (items: ClipboardItem[]) => Promise<void> };
            await clipboardWriter.write([new ClipboardItemClass({ "image/png": png }) as ClipboardItem]);
            return;
        } catch (error) {
            // Some embedded and legacy browsers report a non-secure context
            // even though a user-triggered native copy still works.
            clipboardError = error;
        }
    }

    try {
        await (dependencies.legacyCopy ?? legacyCopyCanvasImage)(png);
    } catch (legacyError) {
        console.warn("[canvas image clipboard copy failed]", { clipboardError, legacyError });
        throw new Error("浏览器阻止写入图片剪贴板；请使用 HTTPS 地址打开，或检查浏览器的剪贴板权限后重试");
    }
}

async function legacyCopyCanvasImage(blob: Blob) {
    if (typeof document === "undefined" || typeof window === "undefined" || typeof document.execCommand !== "function") {
        throw new Error("legacy clipboard copy unavailable");
    }
    const objectUrl = URL.createObjectURL(blob);
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    Object.assign(image.style, {
        position: "fixed",
        left: "-2px",
        top: "-2px",
        width: "1px",
        height: "1px",
        opacity: "0.01",
        pointerEvents: "none",
    });
    document.body.append(image);
    try {
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("clipboard image load failed"));
        });
        const selection = window.getSelection();
        if (!selection) throw new Error("clipboard selection unavailable");
        const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
        const range = document.createRange();
        range.selectNode(image);
        selection.removeAllRanges();
        selection.addRange(range);
        try {
            if (!document.execCommand("copy")) throw new Error("legacy clipboard copy rejected");
        } finally {
            selection.removeAllRanges();
            ranges.forEach((saved) => selection.addRange(saved));
        }
    } finally {
        image.remove();
        URL.revokeObjectURL(objectUrl);
    }
}

async function renderClipboardPng(blob: Blob) {
    if (typeof document === "undefined" || typeof URL === "undefined") {
        throw new Error("当前浏览器无法将该图片格式复制到剪贴板");
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const next = new Image();
            next.onload = () => resolve(next);
            next.onerror = () => reject(new Error("图片格式无法转换为剪贴板格式"));
            next.src = objectUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) throw new Error("图片无法转换为剪贴板格式");
        context.drawImage(image, 0, 0);
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!png) throw new Error("图片无法转换为剪贴板格式");
        return png;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
