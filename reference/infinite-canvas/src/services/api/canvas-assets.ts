import { creatorCanvasAssetContentUrl } from "@/lib/creator/video-client";

export type CanvasAssetKind = "image" | "video" | "audio" | "document";

export type StoredCanvasAsset = {
    assetId: string;
    storagePath: string;
    contentUrl: string;
};

export type PersistedCanvasAsset = StoredCanvasAsset & {
    bytes: number;
    mimeType: string;
};

/**
 * Persist a browser-uploaded canvas file before the graph serialiser removes
 * its temporary object URL.  The returned path is user-private and playback
 * always goes through the same-origin content proxy.
 */
export async function uploadCanvasAsset(file: File, input: { kind: CanvasAssetKind; source: "upload" | "generation" | "project_copy"; name?: string; nodeId?: string; libraryScope?: "material-library"; folderId?: string; folderName?: string }): Promise<StoredCanvasAsset> {
    const form = new FormData();
    form.set("file", file, file.name || input.name || "canvas-asset");
    form.set("kind", input.kind);
    form.set("source", input.source);
    if (input.name) form.set("name", input.name);
    if (input.nodeId) form.set("nodeId", input.nodeId);
    if (input.libraryScope) form.set("libraryScope", input.libraryScope);
    if (input.folderId) form.set("folderId", input.folderId);
    if (input.folderName) form.set("folderName", input.folderName);

    const response = await fetch("/api/creator/canvas-assets", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { assetId?: unknown; storagePath?: unknown; error?: unknown; code?: unknown };
    if (!response.ok || typeof payload.storagePath !== "string" || !payload.storagePath) {
        const message = typeof payload.error === "string" ? payload.error : "素材云端备份失败";
        const code = typeof payload.code === "string" ? payload.code : "UNKNOWN";
        throw new Error(`${message}（${code}）`);
    }
    const assetId = typeof payload.assetId === "string" ? payload.assetId : "";
    console.info("[canvas asset persisted]", { kind: input.kind, assetId, nodeId: input.nodeId || null, scope: input.libraryScope || "asset", folderId: input.folderId || null, storagePath: payload.storagePath });
    return { assetId, storagePath: payload.storagePath, contentUrl: creatorCanvasAssetContentUrl(payload.storagePath) };
}

/**
 * A provider URL or a browser Blob is allowed to be a short-lived preview,
 * never the durable owner of a generated result.  Copy it into creator-assets
 * before callers mark the result as saved in a canvas, workbench, or asset.
 */
export async function persistGeneratedCanvasAsset(
    input: Blob | string,
    options: { kind: CanvasAssetKind; name?: string; nodeId?: string; mimeType?: string },
): Promise<PersistedCanvasAsset> {
    const blob = typeof input === "string"
        ? await fetch(input).then(async (response) => {
            if (!response.ok) throw new Error(`生成结果读取失败（HTTP ${response.status}）`);
            return response.blob();
        })
        : input;
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("生成结果为空，无法保存到云端");

    const mimeType = blob.type || options.mimeType || fallbackMimeType(options.kind);
    const file = new File([blob], options.name || `generated-${options.kind}.${extensionFor(mimeType, options.kind)}`, { type: mimeType });
    const stored = await uploadCanvasAsset(file, {
        kind: options.kind,
        source: "generation",
        name: file.name,
        nodeId: options.nodeId,
    });
    return { ...stored, bytes: file.size, mimeType };
}

function fallbackMimeType(kind: CanvasAssetKind) {
    if (kind === "image") return "image/png";
    if (kind === "video") return "video/mp4";
    if (kind === "audio") return "audio/mpeg";
    return "application/octet-stream";
}

function extensionFor(mimeType: string, kind: CanvasAssetKind) {
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("quicktime")) return "mov";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (kind === "image") return "png";
    if (kind === "video") return "mp4";
    return "bin";
}

export async function deleteMaterialLibraryAsset(assetId: string) {
    const response = await fetch("/api/creator/assets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId }) });
    const payload = await response.json().catch(() => ({})) as { deleted?: unknown; error?: unknown; code?: unknown };
    if (!response.ok || payload.deleted !== true) {
        const message = typeof payload.error === "string" ? payload.error : "删除素材失败";
        const code = typeof payload.code === "string" ? payload.code : "UNKNOWN";
        throw new Error(`${message}（${code}）`);
    }
    console.info("[material library delete completed]", { assetId });
}

export async function moveMaterialLibraryAsset(assetId: string, folderId: string | null, folderName?: string) {
    const response = await fetch("/api/creator/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, folderId, folderName }),
    });
    const payload = await response.json().catch(() => ({})) as { updated?: unknown; error?: unknown; code?: unknown };
    if (!response.ok || payload.updated !== true) {
        const message = typeof payload.error === "string" ? payload.error : "移动素材失败";
        const code = typeof payload.code === "string" ? payload.code : "UNKNOWN";
        throw new Error(`${message}（${code}）`);
    }
    console.info("[material library folder persisted]", { assetId, folderId });
}

export async function renameMaterialLibraryFolder(folderId: string, folderName: string) {
    const response = await fetch("/api/creator/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renameFolder", folderId, folderName }),
    });
    const payload = await response.json().catch(() => ({})) as { renamed?: unknown; error?: unknown; code?: unknown };
    if (!response.ok || payload.renamed !== true) {
        const message = typeof payload.error === "string" ? payload.error : "重命名文件夹失败";
        const code = typeof payload.code === "string" ? payload.code : "UNKNOWN";
        throw new Error(`${message}（${code}）`);
    }
    console.info("[material library folder renamed]", { folderId });
}
