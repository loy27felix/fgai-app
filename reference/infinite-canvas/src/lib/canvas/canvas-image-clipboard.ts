type ClipboardPayload = Blob | Promise<Blob>;
type ClipboardItemConstructor = new (items: Record<string, ClipboardPayload>) => unknown;

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
    const clipboard = (dependencies.clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined)) as CanvasImageClipboardDependencies["clipboard"];
    const ClipboardItemClass = (dependencies.ClipboardItem ?? (typeof window !== "undefined" ? window.ClipboardItem : undefined)) as ClipboardItemConstructor | undefined;
    // Start the image load but hand its promise to ClipboardItem immediately.
    // This keeps the browser's user-activation from the context-menu click,
    // which can be lost if we await fetch() before clipboard.write().
    const pngPromise = readClipboardPng(source, dependencies.fetcher);

    if (!clipboard || !ClipboardItemClass) {
        await pngPromise;
        throw new Error("当前浏览器不支持直接复制图片；请使用最新版 Chrome 或 Edge，并通过 HTTPS 或 localhost 打开");
    }

    try {
        await clipboard.write([new ClipboardItemClass({ "image/png": pngPromise })]);
    } catch (clipboardError) {
        try {
            await pngPromise;
        } catch (imageError) {
            throw imageError instanceof Error ? imageError : new Error("无法读取图片数据，请刷新后重试");
        }
        console.warn("[canvas image clipboard copy failed]", { clipboardError });
        throw new Error("图片未复制：浏览器阻止了图片剪贴板访问。请使用 HTTPS 或 localhost，并允许本网站访问剪贴板后重试");
    }
}

async function readClipboardPng(source: string, fetcher: (input: RequestInfo | URL) => Promise<Response> = fetch) {
    const response = await fetcher(source);
    if (!response.ok) throw new Error("无法读取图片数据，请刷新后重试");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) throw new Error("图片数据无效，无法复制");
    return blob.type === "image/png" ? blob : renderClipboardPng(blob);
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
