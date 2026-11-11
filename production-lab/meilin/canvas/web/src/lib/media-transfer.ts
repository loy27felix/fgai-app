/** Read native files first: browsers often expose the same file via items and files. */
export function filesFromTransfer(transfer: Pick<DataTransfer, "files" | "items">): File[] {
    const files = Array.from(transfer.files || []);
    if (files.length) return files;
    return Array.from(transfer.items || []).flatMap(item => {
        const file = item.kind === "file" ? item.getAsFile() : null;
        return file ? [file] : [];
    });
}

/** Only explicit image content, not an arbitrary link or ordinary pasted text. */
export function imageURLFromTransfer(transfer: Pick<DataTransfer, "getData">, baseURL: string): string | undefined {
    const html = transfer.getData("text/html");
    const source = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") : undefined;
    const uri = transfer.getData("text/uri-list").split(/\r?\n/).find(line => line.trim() && !line.startsWith("#"))?.trim();
    const value = source || (uri && /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(uri) ? uri : undefined);
    if (!value) return;
    try {
        const url = new URL(value, baseURL);
        if (["http:", "https:"].includes(url.protocol) || (url.protocol === "data:" && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value))) return url.href;
        if (url.protocol === "blob:" && url.origin === new URL(baseURL).origin) return url.href;
    } catch { /* Invalid or active-content URLs never become media imports. */ }
}

type DragTransfer = Pick<DataTransfer, "types" | "items"> & Partial<Pick<DataTransfer, "files">>;

export function transferHasFiles(transfer: DragTransfer) {
    // During dragenter/dragover browsers protect file bodies; types/items still
    // identify files. Some desktop integrations expose only the FileList.
    return Boolean(transfer.files?.length) || Array.from(transfer.types || []).includes("Files") || Array.from(transfer.items || []).some(item => item.kind === "file");
}

export function transferHasMedia(transfer: DragTransfer) {
    return transferHasFiles(transfer) || Array.from(transfer.types || []).some(type => type === "text/uri-list" || type === "text/html");
}
