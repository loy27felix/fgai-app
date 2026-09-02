import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/reference/infinite-canvas/src/lib/image-utils";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
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
 * Wetoken-generated images already have a private server-side asset and task
 * record. Do not make display of that paid result depend on IndexedDB: its
 * signed URL is safe for the current session and the canvas will renew it
 * from creatorTaskId after a reload. Other image sources retain the local
 * cache behaviour used for uploads and edits without a durable task.
 */
export async function storeGeneratedImage(image: GeneratedImageSource): Promise<StoredImage> {
    if (!image.creatorTaskId && !image.cloudStoragePath) return uploadImage(image.dataUrl);
    const meta = await readImageMeta(image.dataUrl);
    return {
        url: image.dataUrl,
        width: image.width || meta.width,
        height: image.height || meta.height,
        bytes: 0,
        mimeType: image.mimeType || meta.mimeType,
        ...(image.creatorTaskId ? { creatorTaskId: image.creatorTaskId } : {}),
        ...(image.cloudStoragePath ? { cloudStoragePath: image.cloudStoragePath } : {}),
        ...(image.cloudAssetId ? { cloudAssetId: image.cloudAssetId } : {}),
    };
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
