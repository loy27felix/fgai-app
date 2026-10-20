import { getResource, resourceIdFromStorageKey, resourceStorageKey, resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { imageTransferDimensions, shotReferenceByteTarget } from "@/lib/shot-image-transfer";
import type { ReferenceImage } from "@/types/image";

export type ShotImageTransferRecord = {
    name: string;
    originalResourceId: string;
    submittedResourceId: string;
    originalBytes: number;
    submittedBytes: number;
    originalWidth: number;
    originalHeight: number;
    submittedWidth: number;
    submittedHeight: number;
    optimized: boolean;
};
export type ShotImageTransfer = { images: ReferenceImage[]; records: ShotImageTransferRecord[]; originalBytes: number; submittedBytes: number; mode: "optimized" | "original" };
type Dependencies = {
    inspect: (id: string) => Promise<{ size: number; width?: number; height?: number; mimeType: string }>;
    read: (key: string) => Promise<Blob | null>;
    encode: (blob: Blob, target: number) => Promise<{ blob: Blob; width: number; height: number }>;
    upload: (blob: Blob, key: string, dimensions: { width: number; height: number }) => Promise<{ storageKey: string; url: string; width: number; height: number; bytes: number; mimeType: string }>;
};

/** WebP retains transparency. Only this new transfer copy is resized; originals are untouched. */
export async function encodeShotReference(blob: Blob, target: number) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
    try {
        for (const maxSide of [2048, 1600, 1280]) {
            const dimensions = imageTransferDimensions(bitmap.width, bitmap.height, maxSide);
            canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(dimensions.width, dimensions.height) : Object.assign(document.createElement("canvas"), dimensions);
            const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
            if (!ctx) throw new Error("浏览器无法准备参考图传输副本");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
            for (const quality of [0.92, 0.85, 0.75]) {
                const encoded =
                    "convertToBlob" in canvas
                        ? await canvas.convertToBlob({ type: "image/webp", quality })
                        : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((result) => (result ? resolve(result) : reject(new Error("参考图传输副本导出失败"))), "image/webp", quality));
                if (encoded.type !== "image/webp") throw new Error("浏览器不支持 WebP 传输副本，请更新浏览器或选择上传原图");
                if (encoded.size && encoded.size <= target) return { blob: encoded, ...dimensions };
            }
            canvas.width = canvas.height = 0;
        }
        throw new Error("参考图仍过大，请减少参考图，或另选较小的副本；原资产已保留");
    } finally {
        bitmap.close();
        if (canvas) canvas.width = canvas.height = 0;
    }
}

const defaults: Dependencies = {
    inspect: getResource,
    read: getImageBlob,
    encode: encodeShotReference,
    upload: async (blob, key, dimensions) => {
        const resource = await uploadResourceFile(blob, "image", { ...dimensions, fileName: "shot-reference.webp", idempotencyKey: key });
        if (resource.status !== "ready") throw new Error("参考图传输副本尚未保存成功");
        return {
            storageKey: resourceStorageKey(resource.id),
            url: resourceFileUrl(resource.id),
            width: resource.width || dimensions.width,
            height: resource.height || dimensions.height,
            bytes: resource.size || blob.size,
            mimeType: resource.mimeType || blob.type,
        };
    },
};

export async function prepareShotImageTransfer(images: ReferenceImage[], optimize: boolean, options: { isCurrent?: () => boolean; onProgress?: (message: string) => void } = {}, dependencies: Dependencies = defaults): Promise<ShotImageTransfer> {
    const scope = getActiveUserScope();
    const assertCurrent = () => {
        if (scope !== getActiveUserScope() || options.isCurrent?.() === false) throw new DOMException("参考图准备已取消", "AbortError");
    };
    const records: ShotImageTransferRecord[] = [],
        submitted: ReferenceImage[] = [];
    const target = shotReferenceByteTarget(images.length);
    for (const [index, image] of images.entries()) {
        assertCurrent();
        const originalResourceId = resourceIdFromStorageKey(image.storageKey);
        if (!originalResourceId) throw new Error(`${image.name} 尚未保存到素材库，请先保存后重试`);
        options.onProgress?.(`正在准备 ${index + 1}/${images.length}：${image.name}`);
        const original = await dependencies.inspect(originalResourceId);
        assertCurrent();
        let output = { ...image, bytes: original.size, width: original.width, height: original.height, type: original.mimeType };
        let optimized = false;
        if (optimize && original.size > target) {
            const source = await dependencies.read(image.storageKey!);
            assertCurrent();
            if (!source) throw new Error(`无法读取 ${image.name} 的原图`);
            const encoded = await dependencies.encode(source, target);
            assertCurrent();
            if (!encoded.blob.size || encoded.blob.size > target) throw new Error(`${image.name} 的传输副本仍过大，请调整参考图`);
            const variant = await dependencies.upload(encoded.blob, `shot-transfer-v1:${scope}:${originalResourceId}:${target}`, encoded);
            assertCurrent();
            if (!resourceIdFromStorageKey(variant.storageKey)) throw new Error(`${image.name} 的传输副本尚未保存到服务器`);
            if (!variant.bytes || variant.bytes > target) throw new Error(`${image.name} 的服务端副本仍过大，请调整参考图`);
            output = { ...output, dataUrl: "", url: variant.url, storageKey: variant.storageKey, bytes: variant.bytes, width: variant.width, height: variant.height, type: variant.mimeType };
            optimized = true;
        }
        records.push({
            name: image.name,
            originalResourceId,
            submittedResourceId: resourceIdFromStorageKey(output.storageKey)!,
            originalBytes: original.size,
            submittedBytes: output.bytes,
            originalWidth: original.width || 0,
            originalHeight: original.height || 0,
            submittedWidth: output.width || 0,
            submittedHeight: output.height || 0,
            optimized,
        });
        submitted.push(output);
    }
    assertCurrent();
    return { images: submitted, records, originalBytes: records.reduce((sum, r) => sum + r.originalBytes, 0), submittedBytes: records.reduce((sum, r) => sum + r.submittedBytes, 0), mode: optimize ? "optimized" : "original" };
}
