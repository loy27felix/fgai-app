import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/reference/infinite-canvas/src/lib/image-utils";
import { persistGeneratedCanvasAsset, uploadCanvasAsset } from "@/reference/infinite-canvas/src/services/api/canvas-assets";
import { creatorCanvasAssetContentUrl } from "@/lib/creator/video-client";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    cloudStoragePath?: string;
    cloudAssetId?: string;
};

export type StoredImage = Omit<UploadedImage, "storageKey"> & {
    storageKey?: string;
    creatorTaskId?: string;
    cloudStoragePath?: string;
    cloudAssetId?: string;
};

export type GeneratedImageSource = {
    dataUrl: string;
    creatorTaskId?: string;
    cloudStoragePath?: string;
    cloudAssetId?: string;
    mimeType?: string;
    width?: number | null;
    height?: number | null;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("无法读取图片文件");
    const storageKey = `image:${nanoid()}`;
    try {
        await store.setItem(storageKey, blob);
    } catch (error) {
        throw localImageStorageError(error);
    }
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    try {
        await store.setItem(storageKey, blob);
    } catch (error) {
        throw localImageStorageError(error);
    }
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

/**
 * A generated image may be previewed from a provider URL, but its final owner
 * must always be creator-assets.  Browser IndexedDB is deliberately excluded
 * here: it is a cache, not a cross-device or long-term media store.
 */
export async function storeGeneratedImage(image: GeneratedImageSource): Promise<StoredImage> {
    if (image.cloudStoragePath) {
        return {
            url: creatorCanvasAssetContentUrl(image.cloudStoragePath),
            width: image.width || 1024,
            height: image.height || 1024,
            bytes: 0,
            mimeType: image.mimeType || "image/png",
            ...(image.creatorTaskId ? { creatorTaskId: image.creatorTaskId } : {}),
            cloudStoragePath: image.cloudStoragePath,
            ...(image.cloudAssetId ? { cloudAssetId: image.cloudAssetId } : {}),
        };
    }

    const meta = await readImageMeta(image.dataUrl);

    const stored = await persistGeneratedCanvasAsset(image.dataUrl, {
        kind: "image",
        name: `generated-image.${image.mimeType?.includes("jpeg") ? "jpg" : "png"}`,
        mimeType: image.mimeType || meta.mimeType,
    });
    return {
        url: stored.contentUrl,
        width: image.width || meta.width,
        height: image.height || meta.height,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
        ...(image.creatorTaskId ? { creatorTaskId: image.creatorTaskId } : {}),
        cloudStoragePath: stored.storagePath,
        cloudAssetId: stored.assetId,
    };
}

/** A short-lived object URL for upload progress; unlike uploadImage this never writes IndexedDB. */
export async function previewImage(input: Blob): Promise<UploadedImage> {
    if (!(input instanceof Blob) || input.size === 0) throw new Error("无法读取图片文件");
    const url = URL.createObjectURL(input);
    const meta = await readImageMeta(url);
    return { url, storageKey: "", width: meta.width, height: meta.height, bytes: input.size, mimeType: input.type || meta.mimeType };
}

/**
 * Saves a user-supplied image to creator-assets before returning it to any
 * canvas/workbench state.  The object URL used to read dimensions is only a
 * short-lived preview and is revoked before the function resolves.
 */
export async function persistCanvasImage(
    input: Blob,
    options: { name?: string; source?: "upload" | "generation" | "project_copy"; nodeId?: string; folderId?: string; libraryScope?: "material-library" } = {},
): Promise<UploadedImage> {
    if (!(input instanceof Blob) || input.size === 0) throw new Error("无法读取图片文件");
    const preview = await previewImage(input);
    try {
        const name = options.name || "canvas-image.png";
        const file = input instanceof File && input.name
            ? input
            : new File([input], name, { type: input.type || preview.mimeType || "image/png" });
        const stored = await uploadCanvasAsset(file, {
            kind: "image",
            source: options.source || "upload",
            name,
            nodeId: options.nodeId,
            folderId: options.folderId,
            libraryScope: options.libraryScope,
        });
        return {
            ...preview,
            url: stored.contentUrl,
            storageKey: "",
            cloudStoragePath: stored.storagePath,
            cloudAssetId: stored.assetId,
        };
    } finally {
        URL.revokeObjectURL(preview.url);
    }
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

function localImageStorageError(error: unknown) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "QuotaExceededError" || /quota|space|容量|空间/i.test(message)) {
        return new Error("本地浏览器存储空间不足，请清理后重试");
    }
    return new Error("浏览器本地媒体缓存不可用，请检查网站存储权限或改用普通窗口；已保存到云端的生成图可从生成记录恢复");
}
