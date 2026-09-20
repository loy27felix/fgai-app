import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/reference/infinite-canvas/src/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, storeGeneratedImage } from "@/reference/infinite-canvas/src/services/image-storage";
import { cleanupUnusedMedia, persistCanvasMedia, resolveMediaUrl } from "@/reference/infinite-canvas/src/services/file-storage";
import { readGenerationLogStorageSnapshot } from "@/reference/infinite-canvas/src/services/generation-storage";
import { creatorCanvasAssetContentUrl, creatorVideoContentUrl } from "@/lib/creator/video-client";
import { runCanvasRequest } from "@/reference/infinite-canvas/src/lib/canvas/canvas-request-pool";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; cloudStoragePath?: string; cloudAssetId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; cloudStoragePath?: string; cloudAssetId?: string; creatorTaskId?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; cloudStoragePath?: string; cloudAssetId?: string; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    /** Stable workspace material-library folder identifier. */
    folderId?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map((asset) => runCanvasRequest(asset.kind === "video" ? "video" : "image", async () => {
                if (asset.kind === "video") {
                    const durableUrl = asset.data.creatorTaskId
                        ? creatorVideoContentUrl(asset.data.creatorTaskId)
                        : asset.data.cloudStoragePath
                            ? creatorCanvasAssetContentUrl(asset.data.cloudStoragePath)
                            : "";
                    if (durableUrl) {
                        console.info("[material library asset hydrated]", { assetId: asset.id, kind: asset.kind, source: asset.data.creatorTaskId ? "creator-task" : "canvas-asset" });
                        return { ...asset, data: { ...asset.data, url: durableUrl, storageKey: undefined } };
                    }
                    if (asset.data.storageKey) {
                        const localUrl = await resolveMediaUrl(asset.data.storageKey, "");
                        if (localUrl) {
                            try {
                                const stored = await persistCanvasMedia(await fetch(localUrl).then((response) => response.blob()), { kind: "video", name: asset.title || "legacy-video.mp4", source: "project_copy" });
                                return { ...asset, data: { ...asset.data, url: stored.url, storageKey: undefined, cloudStoragePath: stored.cloudStoragePath, cloudAssetId: stored.cloudAssetId, bytes: stored.bytes, mimeType: stored.mimeType, width: stored.width || asset.data.width, height: stored.height || asset.data.height } };
                            } catch {
                                return { ...asset, data: { ...asset.data, url: localUrl } };
                            }
                        }
                    }
                    if (asset.data.url.startsWith("blob:")) {
                        console.warn("[material library asset hydration unavailable]", { assetId: asset.id, kind: asset.kind, hasStorageKey: Boolean(asset.data.storageKey) });
                        return { ...asset, data: { ...asset.data, url: "" }, metadata: { ...asset.metadata, playbackError: "视频本地副本已失效，且没有云端备份" } };
                    }
                    return asset;
                }
                if (asset.kind === "audio") {
                    const durableUrl = asset.data.cloudStoragePath ? creatorCanvasAssetContentUrl(asset.data.cloudStoragePath) : "";
                    if (durableUrl) {
                        console.info("[material library asset hydrated]", { assetId: asset.id, kind: asset.kind, source: "canvas-asset" });
                        return { ...asset, data: { ...asset.data, url: durableUrl, storageKey: undefined } };
                    }
                    if (asset.data.storageKey) {
                        const localUrl = await resolveMediaUrl(asset.data.storageKey, "");
                        if (localUrl) {
                            try {
                                const stored = await persistCanvasMedia(await fetch(localUrl).then((response) => response.blob()), { kind: "audio", name: asset.title || "legacy-audio.mp3", source: "project_copy" });
                                return { ...asset, data: { ...asset.data, url: stored.url, storageKey: undefined, cloudStoragePath: stored.cloudStoragePath, cloudAssetId: stored.cloudAssetId, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs || asset.data.durationMs } };
                            } catch {
                                return { ...asset, data: { ...asset.data, url: localUrl } };
                            }
                        }
                    }
                    if (asset.data.url.startsWith("blob:")) {
                        console.warn("[material library asset hydration unavailable]", { assetId: asset.id, kind: asset.kind, hasStorageKey: Boolean(asset.data.storageKey) });
                        return { ...asset, data: { ...asset.data, url: "" }, metadata: { ...asset.metadata, playbackError: "音频本地副本已失效，且没有云端备份" } };
                    }
                    return asset;
                }
                if (asset.kind !== "image") return asset;
                if (asset.data.cloudStoragePath) {
                    const durableUrl = creatorCanvasAssetContentUrl(asset.data.cloudStoragePath);
                    console.info("[material library image hydrated]", { assetId: asset.id, source: "canvas-asset" });
                    return { ...asset, coverUrl: durableUrl, data: { ...asset.data, dataUrl: durableUrl, storageKey: undefined } };
                }
                if (asset.data.storageKey) {
                    const localUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
                    if (!localUrl) return asset;
                    try {
                        const image = await storeGeneratedImage({ dataUrl: localUrl, mimeType: asset.data.mimeType, width: asset.data.width, height: asset.data.height });
                        return { ...asset, coverUrl: image.url, data: { ...asset.data, dataUrl: image.url, storageKey: undefined, cloudStoragePath: image.cloudStoragePath, cloudAssetId: image.cloudAssetId, bytes: image.bytes, mimeType: image.mimeType, width: image.width, height: image.height } };
                    } catch {
                        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? localUrl : asset.coverUrl, data: { ...asset.data, dataUrl: localUrl } };
                    }
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await storeGeneratedImage({ dataUrl: asset.data.dataUrl, mimeType: asset.data.mimeType, width: asset.data.width, height: asset.data.height });
                return { ...asset, coverUrl: image.url, data: { ...asset.data, dataUrl: image.url, storageKey: undefined, cloudStoragePath: image.cloudStoragePath, cloudAssetId: image.cloudAssetId, bytes: image.bytes, mimeType: image.mimeType, width: image.width, height: image.height } };
            })),
        );
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/reference/infinite-canvas/src/stores/canvas/use-canvas-store");
                    const generationLogs = await readGenerationLogStorageSnapshot();
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, generationLogs, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, generationLogs, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
