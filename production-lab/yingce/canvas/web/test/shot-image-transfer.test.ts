import { describe, expect, test } from "bun:test";
import { imageTransferDimensions, SHOT_REFERENCE_TOTAL_TARGET, shotReferenceByteTarget } from "@/lib/shot-image-transfer";
import { prepareShotImageTransfer } from "@/services/shot-image-transfer";
import { selectShotImageReferences } from "@/pages/projects/detail/shot-image-references";
import { ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt, type ShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";
import type { ReferenceImage } from "@/types/image";

const names = ["苏晚", "凌玄", "剑宗婚房", "红色喜帐床幔", "红色嫁衣", "红烛"];
const sizes = [10490596, 10067800, 9270566, 8826873, 2528243, 9257927];
const images: ReferenceImage[] = names.map((name, index) => ({ id: `asset-${index}`, name, type: "image/png", storageKey: `resource:original-${index}`, dataUrl: "" }));
const context: ShotAssetReferenceContext = {
    referenceImages: images,
    referenceAudios: [{ id: "voice", name: "旧声音样本", type: "audio/wav", url: "", storageKey: "resource:voice" }],
    assetReferences: names.map((title, index) => ({ assetId: `asset-${index}`, title, category: index < 2 ? "character" : "prop", imageIndex: index + 1, audioIndex: 1 })),
    mentionReferences: names.map((title, index) => ({ id: title, nodeId: "", assetId: `asset-${index}`, kind: index < 2 ? "character" : "image", label: title, title, active: true })),
    resolvedCharacterVersions: [0, 1].map((index) => ({ assetId: `asset-${index}`, versionId: `version-${index}` })),
};

function harness() {
    const reads: string[] = [],
        uploads: string[] = [],
        encodes: number[] = [];
    const dependencies = {
        inspect: async (id: string) => ({ size: sizes[Number(id.split("-").at(-1))], width: 3264, height: 2448, mimeType: "image/png" }),
        read: async (key: string) => {
            reads.push(key);
            return new Blob(["original"], { type: "image/png" });
        },
        encode: async (_blob: Blob, target: number) => {
            encodes.push(target);
            return { blob: new Blob([new Uint8Array(500_000)], { type: "image/webp" }), width: 2048, height: 1536 };
        },
        upload: async (blob: Blob, key: string, dimensions: { width: number; height: number }) => {
            uploads.push(key);
            return { storageKey: `resource:copy-${uploads.length}`, url: "", ...dimensions, bytes: blob.size, mimeType: blob.type };
        },
    };
    return { dependencies, reads, uploads, encodes };
}

describe("storyboard references and transport", () => {
    test("six formerly rejected originals keep their identities but submit small, separately saved copies", async () => {
        const before = structuredClone(images),
            h = harness();
        const result = await prepareShotImageTransfer(images, true, {}, h.dependencies);
        expect(result.originalBytes).toBe(50_442_005);
        expect(result.submittedBytes).toBe(3_000_000);
        expect(result.submittedBytes).toBeLessThan(SHOT_REFERENCE_TOTAL_TARGET);
        expect(result.images.map((image) => image.name)).toEqual(names);
        expect(result.images.every((image) => image.storageKey?.startsWith("resource:copy-") && image.width === 2048 && image.height === 1536 && image.type === "image/webp")).toBe(true);
        expect(result.records.every((record) => record.optimized && record.originalResourceId.startsWith("original-") && record.submittedResourceId.startsWith("copy-") && record.originalBytes > record.submittedBytes)).toBe(true);
        expect(h.uploads).toHaveLength(6);
        expect(images).toEqual(before);
    });
    test("original mode never reads, encodes or uploads a replacement", async () => {
        const h = harness();
        const result = await prepareShotImageTransfer(images, false, {}, h.dependencies);
        expect(result.originalBytes).toBe(result.submittedBytes);
        expect(result.images.map((image) => image.storageKey)).toEqual(images.map((image) => image.storageKey));
        expect(h.reads).toHaveLength(0);
        expect(h.encodes).toHaveLength(0);
        expect(h.uploads).toHaveLength(0);
    });
    test("small originals are reused without lossy encoding", async () => {
        const h = harness();
        h.dependencies.inspect = async () => ({ size: 150_000, width: 800, height: 1200, mimeType: "image/png" });
        const result = await prepareShotImageTransfer(images, true, {}, h.dependencies);
        expect(result.records.every((record) => !record.optimized && record.originalResourceId === record.submittedResourceId)).toBe(true);
        expect(h.encodes).toHaveLength(0);
        expect(h.uploads).toHaveLength(0);
    });
    test("closing the modal during download prevents later uploads", async () => {
        const h = harness();
        let current = true;
        h.dependencies.read = async () => {
            current = false;
            return new Blob(["source"]);
        };
        await expect(prepareShotImageTransfer(images, true, { isCurrent: () => current }, h.dependencies)).rejects.toThrow("取消");
        expect(h.encodes).toHaveLength(0);
        expect(h.uploads).toHaveLength(0);
    });
    test("an oversized server copy or missing persisted resource stops preparation", async () => {
        const h = harness();
        h.dependencies.upload = async (_blob, _key, dimensions) => ({ storageKey: "resource:oversized", url: "", ...dimensions, bytes: 20_000_000, mimeType: "image/webp" });
        await expect(prepareShotImageTransfer(images, true, {}, h.dependencies)).rejects.toThrow("服务端副本仍过大");
        await expect(prepareShotImageTransfer([{ ...images[0], storageKey: "image:local-only" }], true, {}, h.dependencies)).rejects.toThrow("尚未保存到素材库");
    });
    test("deselection reindexes the actual images, removes stale tokens and never changes shot/video bindings", () => {
        const before = structuredClone(context);
        const selected = selectShotImageReferences(context, new Set(["asset-1", "asset-5"]));
        expect(selected.referenceImages.map((image) => image.name)).toEqual(["凌玄", "红烛"]);
        expect(selected.assetReferences.map((reference) => reference.imageIndex)).toEqual([1, 2]);
        expect(selected.assetReferences.every((reference) => reference.audioIndex === undefined)).toBe(true);
        expect(selected.referenceAudios).toEqual([]);
        expect(selected.resolvedCharacterVersions).toEqual([{ assetId: "asset-1", versionId: "version-1" }]);
        const originalPrompt = ensureShotAssetMentionPrompt("苏晚在电话里说话，凌玄拿起红烛。", context.mentionReferences);
        const prompt = resolveShotAssetMentionPrompt(ensureShotAssetMentionPrompt(originalPrompt, selected.mentionReferences), selected);
        expect(prompt).toContain("苏晚在电话里说话，凌玄拿起红烛。");
        expect(prompt).toContain("凌玄：图片1");
        expect(prompt).toContain("红烛：图片2");
        expect(prompt).not.toContain("@[asset:");
        expect(prompt).not.toContain("图片6");
        expect(context).toEqual(before);
    });
    test("no selected images produces text only without leftover bindings", () => {
        const selected = selectShotImageReferences(context, new Set());
        expect(selected.referenceImages).toEqual([]);
        expect(resolveShotAssetMentionPrompt(ensureShotAssetMentionPrompt("凌玄：@[asset:asset-1]\n凌玄拿起红烛。", selected.mentionReferences), selected)).toBe("凌玄拿起红烛。");
    });
    test("resizing preserves ratio and never upscales small references", () => {
        expect(imageTransferDimensions(3264, 2448, 2048)).toEqual({ width: 2048, height: 1536 });
        expect(imageTransferDimensions(1024, 1536, 2048)).toEqual({ width: 1024, height: 1536 });
        expect(() => imageTransferDimensions(100_000, 100_000, 2048)).toThrow();
        for (const count of [1, 6, 16, 30]) expect(shotReferenceByteTarget(count) * count).toBeLessThanOrEqual(SHOT_REFERENCE_TOTAL_TARGET);
    });
});
