import { creatorCanvasAssetContentUrl } from "@/lib/creator/video-client";

export type CanvasAssetKind = "image" | "video" | "audio" | "document";

export type StoredCanvasAsset = {
    assetId: string;
    storagePath: string;
    contentUrl: string;
};

/**
 * Persist a browser-uploaded canvas file before the graph serialiser removes
 * its temporary object URL.  The returned path is user-private and playback
 * always goes through the same-origin content proxy.
 */
export async function uploadCanvasAsset(file: File, input: { kind: CanvasAssetKind; source: "upload" | "generation" | "project_copy"; name?: string; nodeId?: string; libraryScope?: "material-library"; folderId?: string }): Promise<StoredCanvasAsset> {
    const form = new FormData();
    form.set("file", file, file.name || input.name || "canvas-asset");
    form.set("kind", input.kind);
    form.set("source", input.source);
    if (input.name) form.set("name", input.name);
    if (input.nodeId) form.set("nodeId", input.nodeId);
    if (input.libraryScope) form.set("libraryScope", input.libraryScope);
    if (input.folderId) form.set("folderId", input.folderId);

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

export async function moveMaterialLibraryAsset(assetId: string, folderId: string | null) {
    const response = await fetch("/api/creator/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, folderId }),
    });
    const payload = await response.json().catch(() => ({})) as { updated?: unknown; error?: unknown; code?: unknown };
    if (!response.ok || payload.updated !== true) {
        const message = typeof payload.error === "string" ? payload.error : "移动素材失败";
        const code = typeof payload.code === "string" ? payload.code : "UNKNOWN";
        throw new Error(`${message}（${code}）`);
    }
    console.info("[material library folder persisted]", { assetId, folderId });
}
