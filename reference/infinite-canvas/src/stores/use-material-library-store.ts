import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { creatorCanvasAssetContentUrl } from "@/lib/creator/video-client";
import { localForageStorage } from "@/reference/infinite-canvas/src/lib/localforage-storage";

export const MATERIAL_LIBRARY_DRAG_MIME = "application/x-fg-studio-material-library";

export type MaterialKind = "image" | "video" | "audio";

export type MaterialFolder = {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
};

export type MaterialItem = {
    id: string;
    kind: MaterialKind;
    title: string;
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
    storagePath?: string;
    cloudAssetId?: string;
    folderId: string | null;
    // Stored with every cloud asset so a custom folder name can be restored
    // even after the browser-local material-library cache is unavailable.
    folderName?: string;
    createdAt: string;
    updatedAt: string;
};

export type MaterialInsertPayload =
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string; cloudStoragePath?: string; cloudAssetId?: string; width?: number; height?: number; origin?: "library" | "upload" }
    | { kind: "video"; url: string; title: string; storageKey?: string; cloudStoragePath?: string; cloudAssetId?: string; creatorTaskId?: string; width?: number; height?: number; origin?: "library" | "upload" }
    | { kind: "audio"; url: string; title: string; storageKey?: string; mimeType: string; cloudStoragePath?: string; cloudAssetId?: string; durationMs?: number; origin?: "library" | "upload" };

type MaterialLibraryStore = {
    hydrated: boolean;
    folders: MaterialFolder[];
    items: MaterialItem[];
    addFolder: (name: string, parentId?: string | null) => string;
    renameFolder: (id: string, name: string) => void;
    removeFolder: (id: string) => void;
    addItem: (item: Omit<MaterialItem, "id" | "createdAt" | "updatedAt">) => string;
    updateItem: (id: string, patch: Partial<Pick<MaterialItem, "title" | "folderId" | "folderName">>) => void;
    removeItem: (id: string) => void;
    replaceRemoteItems: (items: MaterialItem[]) => void;
    migrateLegacyItems: (assets: Array<Record<string, unknown>>) => void;
};

const STORE_KEY = "infinite-canvas:material-library-store";

const storage: PersistStorage<MaterialLibraryStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        return value ? JSON.parse(value) as StorageValue<MaterialLibraryStore> : null;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

function safeFolderName(value: string) {
    return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

function materialFolderId(metadata: Record<string, unknown>) {
    const raw = typeof metadata.library_folder_id === "string"
        ? metadata.library_folder_id
        : typeof metadata.library_folder === "string"
            ? metadata.library_folder
            : "";
    const id = raw.trim();
    // The retired merged material tab wrote this sentinel for the default
    // bucket. It must remain the built-in "未分类" option, not a second folder
    // with the same label.
    return id && id !== "uncategorized" ? id : null;
}

function ensureFolder(state: Pick<MaterialLibraryStore, "folders">, id: string, name?: string) {
    const normalizedName = typeof name === "string" ? safeFolderName(name) : "";
    const existing = state.folders.find((folder) => folder.id === id);
    if (existing) {
        if (!normalizedName || existing.name === normalizedName) return state.folders;
        return state.folders.map((folder) => folder.id === id ? { ...folder, name: normalizedName } : folder);
    }
    return [...state.folders, { id, name: normalizedName || "未分类", parentId: null, createdAt: new Date().toISOString() }];
}

function withoutLegacyUncategorizedFolder(folders: MaterialFolder[]) {
    return folders.filter((folder) => folder.id !== "uncategorized");
}

function normalizeLegacyUncategorizedItems(items: MaterialItem[]) {
    return items.map((item) => item.folderId === "uncategorized" ? { ...item, folderId: null, folderName: undefined } : item);
}

export function materialToInsertPayload(item: MaterialItem): MaterialInsertPayload {
    if (item.kind === "image") return { kind: "image", dataUrl: item.url, title: item.title, cloudStoragePath: item.storagePath, cloudAssetId: item.cloudAssetId, width: item.width, height: item.height };
    if (item.kind === "video") return { kind: "video", url: item.url, title: item.title, cloudStoragePath: item.storagePath, cloudAssetId: item.cloudAssetId, width: item.width, height: item.height };
    return { kind: "audio", url: item.url, title: item.title, mimeType: item.mimeType, cloudStoragePath: item.storagePath, cloudAssetId: item.cloudAssetId, durationMs: item.durationMs };
}

export function materialFromCreatorAsset(asset: Record<string, unknown>): MaterialItem | null {
    const kind = asset.kind;
    if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
    const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
    const storagePath = typeof asset.storagePath === "string" ? asset.storagePath : "";
    const id = typeof asset.id === "string" ? asset.id : "";
    if (!id || !storagePath) return null;
    return {
        id,
        kind,
        title: typeof asset.name === "string" ? asset.name : "未命名素材",
        url: creatorCanvasAssetContentUrl(storagePath),
        mimeType: typeof asset.mimeType === "string" ? asset.mimeType : kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
        width: Number(asset.width) || undefined,
        height: Number(asset.height) || undefined,
        durationMs: Number(asset.durationMs) || undefined,
        storagePath,
        cloudAssetId: id,
        folderId: materialFolderId(metadata),
        folderName: typeof metadata.library_folder_name === "string" ? safeFolderName(metadata.library_folder_name) || undefined : undefined,
        createdAt: typeof asset.createdAt === "string" ? asset.createdAt : new Date().toISOString(),
        updatedAt: typeof asset.updatedAt === "string" ? asset.updatedAt : new Date().toISOString(),
    };
}

export const useMaterialLibraryStore = create<MaterialLibraryStore>()(
    persist(
        (set) => ({
            hydrated: false,
            folders: [],
            items: [],
            addFolder: (name, parentId = null) => {
                const normalized = safeFolderName(name);
                if (!normalized) return "";
                const id = `folder-${nanoid(10)}`;
                set((state) => ({ folders: [...state.folders, { id, name: normalized, parentId, createdAt: new Date().toISOString() }] }));
                console.info("[material library folder created]", { folderId: id, parentId });
                return id;
            },
            renameFolder: (id, name) => {
                const normalized = safeFolderName(name);
                if (!normalized) return;
                set((state) => ({ folders: state.folders.map((folder) => folder.id === id ? { ...folder, name: normalized } : folder) }));
            },
            removeFolder: (id) => set((state) => ({ folders: state.folders.filter((folder) => folder.id !== id), items: state.items.map((item) => item.folderId === id ? { ...item, folderId: null } : item) })),
            addItem: (item) => {
                const id = item.cloudAssetId || `material-${nanoid(12)}`;
                const now = new Date().toISOString();
                set((state) => ({
                    folders: item.folderId ? ensureFolder(state, item.folderId, item.folderName) : state.folders,
                    items: [{ ...item, id, createdAt: now, updatedAt: now }, ...state.items.filter((existing) => existing.id !== id && existing.cloudAssetId !== item.cloudAssetId)],
                }));
                console.info("[material library item added]", { materialId: id, kind: item.kind, folderId: item.folderId });
                return id;
            },
            updateItem: (id, patch) => set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) })),
            removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
            replaceRemoteItems: (remoteItems) => set((state) => {
                const remoteIds = new Set(remoteItems.map((item) => item.cloudAssetId || item.id));
                const localOnly = normalizeLegacyUncategorizedItems(state.items.filter((item) => !item.cloudAssetId || !remoteIds.has(item.cloudAssetId)));
                const folders = remoteItems.reduce((result, item) => item.folderId ? ensureFolder({ folders: result }, item.folderId, item.folderName) : result, withoutLegacyUncategorizedFolder(state.folders));
                return { folders, items: [...remoteItems, ...localOnly] };
            }),
            migrateLegacyItems: (assets) => set((state) => {
                const legacy = assets.flatMap((asset) => {
                    const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
                    const kind = asset.kind;
                    if ((kind !== "image" && kind !== "video" && kind !== "audio") || typeof metadata.library_folder !== "string") return [];
                    const id = typeof asset.id === "string" ? asset.id : `legacy-${nanoid(10)}`;
                    const url = kind === "image"
                        ? String((asset.data as Record<string, unknown> | undefined)?.dataUrl || asset.coverUrl || "")
                        : String((asset.data as Record<string, unknown> | undefined)?.url || "");
                    if (!url) return [];
                    return [{ id, kind, title: typeof asset.title === "string" ? asset.title : "导入素材", url, mimeType: String((asset.data as Record<string, unknown> | undefined)?.mimeType || "application/octet-stream"), folderId: materialFolderId(metadata), folderName: typeof metadata.library_folder_name === "string" ? safeFolderName(metadata.library_folder_name) || undefined : undefined, createdAt: typeof asset.createdAt === "string" ? asset.createdAt : new Date().toISOString(), updatedAt: typeof asset.updatedAt === "string" ? asset.updatedAt : new Date().toISOString() } as MaterialItem];
                });
                const existingFolders = withoutLegacyUncategorizedFolder(state.folders);
                const existingItems = normalizeLegacyUncategorizedItems(state.items);
                if (!legacy.length) return { folders: existingFolders, items: existingItems };
                const legacyIds = new Set(legacy.map((item) => item.id));
                const folders = legacy.reduce((result, item) => item.folderId ? ensureFolder({ folders: result }, item.folderId, item.folderName) : result, existingFolders);
                console.info("[material library legacy migration]", { migrated: legacy.length });
                return { folders, items: [...legacy, ...existingItems.filter((item) => !legacyIds.has(item.id))] };
            }),
        }),
        {
            name: STORE_KEY,
            storage,
            partialize: (state) => ({ folders: state.folders, items: state.items }) as StorageValue<MaterialLibraryStore>["state"],
            onRehydrateStorage: () => () => useMaterialLibraryStore.setState({ hydrated: true }),
        },
    ),
);
