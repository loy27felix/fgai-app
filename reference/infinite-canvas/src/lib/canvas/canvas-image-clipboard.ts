type ClipboardItemConstructor = new (items: Record<string, Blob>) => unknown;

type CanvasImageClipboardDependencies = {
    fetcher?: (input: RequestInfo | URL) => Promise<Response>;
    clipboard?: { write: (items: unknown[]) => Promise<void> };
    ClipboardItem?: ClipboardItemConstructor;
};

/**
 * Writes the actual image bytes to the system clipboard.  Canvas graph copy
 * deliberately stays separate, so Ctrl/Cmd+C can keep its node-copy behavior.
 */
export async function copyCanvasImageToClipboard(source: string, dependencies: CanvasImageClipboardDependencies = {}) {
    const clipboard = dependencies.clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
    const ClipboardItemClass = dependencies.ClipboardItem ?? (typeof window !== "undefined" ? window.ClipboardItem : undefined);
    if (!clipboard || !ClipboardItemClass || (typeof window !== "undefined" && !window.isSecureContext)) {
        throw new Error("当前浏览器环境不支持复制图片，请使用 HTTPS 或 localhost 后重试");
    }

    const response = await (dependencies.fetcher ?? fetch)(source);
    if (!response.ok) throw new Error("无法读取图片数据，请刷新后重试");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) throw new Error("图片数据无效，无法复制");

    const png = blob.type === "image/png" ? blob : await renderClipboardPng(blob);
    const clipboardWriter = clipboard as { write: (items: ClipboardItem[]) => Promise<void> };
    await clipboardWriter.write([new ClipboardItemClass({ "image/png": png }) as ClipboardItem]);
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
