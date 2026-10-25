import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, inferShotVisualAssets, resolveShotAssetMentionPrompt } from "@/pages/projects/detail/workflow-shot-references";
import { assertVideoCapability } from "@/services/api/video-validation";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";

describe("workflow shot asset references", () => {
    test("polling order changes do not change image indices or reference labels", () => {
        const source = detail();
        const before = buildShotAssetReferenceContext(source, "shot-1");
        source.shotReferences.reverse();
        const after = buildShotAssetReferenceContext(source, "shot-1");
        expect(after.referenceImages.map(image => image.id)).toEqual(before.referenceImages.map(image => image.id));
        expect(after.assetReferences).toEqual(before.assetReferences);
        source.shotReferences.forEach(reference => { reference.createdAt = "2026-10-25T00:00:00Z"; });
        const tied = buildShotAssetReferenceContext(source, "shot-1");
        source.shotReferences.reverse();
        expect(buildShotAssetReferenceContext(source, "shot-1").referenceImages.map(image => image.id)).toEqual(tied.referenceImages.map(image => image.id));
    });
    test("removing a bound asset removes its generated mention but keeps authored story text", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("主角看向街道。", context.mentionReferences);
        const remaining = context.mentionReferences.filter(item => item.assetId !== "asset-scene");
        const cleaned = ensureShotAssetMentionPrompt(prompt, remaining);
        expect(cleaned).not.toContain("@[asset:asset-scene]");
        expect(cleaned).toContain("主角看向街道。");
        expect(cleaned).toContain("@[asset:asset-character]");
        expect(() => resolveShotAssetMentionPrompt(cleaned, { ...context, mentionReferences: remaining })).not.toThrow();
        expect(ensureShotAssetMentionPrompt(cleaned, remaining)).toBe(cleaned);
    });
    test("project reference placeholders are not mistaken for an unsupported image codec", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const profile = defaultModelCapabilityConfig().video!;
        profile.references.imageFormats = ["png", "jpeg", "webp"];
        profile.references.maxImages = 9;
        expect(() => assertVideoCapability(profile, context.referenceImages, [], [], String(profile.duration.default))).not.toThrow();
        expect(() => assertVideoCapability(profile, [{ ...context.referenceImages[0], type: "image/avif" }], [], [], String(profile.duration.default))).toThrow("参考素材格式");
    });
    test("auto matches confirmed visuals by segment names, ignoring unmentioned assets and text-only definitions", () => {
        const assets = detail().assets;
        assets.push({ ...assets[0], id: "text-prop", title: "旧信封", category: "prop", mediaType: "text", storageKey: undefined });
        expect(inferShotVisualAssets(assets, "林默走进雨夜街道，拿出旧信封").map((asset) => asset.id)).toEqual(["asset-scene", "asset-character"]);
        expect(inferShotVisualAssets(assets, "雨夜街道空景").map((asset) => asset.id)).toEqual(["asset-scene"]);
    });
    test("does not guess duplicate names or English name substrings", () => {
        const scene = detail().assets[0];
        const assets = [{ ...scene, id: "a", title: "Evan" }, { ...scene, id: "b", title: "门牌" }, { ...scene, id: "c", title: "门牌" }];
        expect(inferShotVisualAssets(assets, "Evans 拿起门牌")).toEqual([]);
        expect(inferShotVisualAssets(assets, "Evan: Hello.").map((asset) => asset.id)).toEqual(["a"]);
    });
    test("builds ordered image references for bound media and characters", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(context.mentionReferences.map((reference) => reference.label)).toEqual(["雨夜街道", "林默"]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["asset-scene", "asset-character"]);
        expect(context.referenceImages[1]?.storageKey).toBe("resource:character-cover");
    });

    test("resolves asset tokens to the submitted reference image order", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `让 ${canvasResourceMentionToken(character)} 从 ${canvasResourceMentionToken(scene)} 走近镜头`;

        expect(resolveShotAssetMentionPrompt(prompt, context)).toContain("让 图片2 从 图片1 走近镜头");
    });

    test("rejects stale mentions after an asset is unbound", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:missing]", context)).toThrow("未绑定到当前镜头");
    });

    test("adds bound assets as editable mention tokens without duplicating existing mentions", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("让 @[asset:asset-character] 走近镜头", context.mentionReferences);

        expect(prompt).toContain("@[asset:asset-character]");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(prompt).toContain("【场景与道具参考】\n雨夜街道：@[asset:asset-scene]");
    });
});

function detail(): ProjectDetail {
    const scene = {
        id: "asset-scene",
        title: "雨夜街道",
        mediaType: "image",
        category: "environment",
        status: "confirmed",
        primaryVersionId: "version-scene",
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: "resource:scene-image",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    const character = {
        id: "asset-character",
        title: "林默",
        mediaType: "entity",
        category: "character",
        status: "confirmed",
        primaryVersionId: "version-character",
        versionCount: 1,
        usages: [],
        position: 1,
        updatedAt: "2026-08-29T00:00:00Z",
        character: {
            versionId: "version-character",
            version: 1,
            definition: {},
            representations: [{ id: "representation-1", resourceId: "character-cover", mediaType: "image", role: "primary" }],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } satisfies ProjectAsset;
    const audio = {
        id: "asset-audio",
        title: "雨声",
        mediaType: "audio",
        category: "other",
        status: "confirmed",
        primaryVersionId: "version-audio",
        versionCount: 1,
        usages: [],
        position: 2,
        storageKey: "resource:rain-audio",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    return {
        assets: [scene, character, audio],
        shotReferences: [
            { id: "reference-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:00Z" },
            { id: "reference-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:01Z" },
            { id: "reference-audio", shotId: "shot-1", assetVersionId: "version-audio", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:02Z" },
            { id: "reference-other-shot", shotId: "shot-2", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:03Z" },
        ],
    } as ProjectDetail;
}
