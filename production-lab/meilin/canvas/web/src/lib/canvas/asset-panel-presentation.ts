import type { Asset } from "@/stores/use-asset-store";
import { resourceStorageLabel } from "./resource-storage-status";

export function assetPanelPresentation(asset: Asset) {
    const storageKey = asset.kind === "entity" ? asset.data.coverStorageKey : "storageKey" in asset.data ? asset.data.storageKey : undefined;
    return {
        storageKey,
        cover: asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : ""),
        status: asset.kind === "entity" ? storageKey || asset.coverUrl ? "形象已就绪" : "形象待完善" : resourceStorageLabel(storageKey),
        insertable: ["image", "video", "audio", "text", "entity"].includes(asset.kind),
    };
}
