import type { ShotAssetReferenceContext } from "./workflow-shot-references";

/** A per-generation choice must not unlink assets from this shot or affect video. */
export function selectShotImageReferences(context: ShotAssetReferenceContext, selectedAssetIds: ReadonlySet<string>): ShotAssetReferenceContext {
    const kept = context.assetReferences.filter((reference) => selectedAssetIds.has(reference.assetId));
    const indices = [...new Set(kept.map((reference) => reference.imageIndex))].sort((a, b) => a - b);
    return {
        mentionReferences: context.mentionReferences.filter((reference) => selectedAssetIds.has(reference.assetId || "")),
        referenceImages: indices.flatMap((index) => (context.referenceImages[index - 1] ? [context.referenceImages[index - 1]] : [])),
        referenceAudios: [],
        assetReferences: kept.map(({ audioIndex: _audio, ...reference }) => ({ ...reference, imageIndex: indices.indexOf(reference.imageIndex) + 1 })),
        resolvedCharacterVersions: context.resolvedCharacterVersions.filter((reference) => selectedAssetIds.has(reference.assetId)),
    };
}
