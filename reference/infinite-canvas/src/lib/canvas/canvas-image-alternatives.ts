import type { CanvasImageAlternative, CanvasNodeMetadata } from "@/reference/infinite-canvas/src/types/canvas";

type ImageMediaFields = Pick<
    CanvasNodeMetadata,
    "content" | "storageKey" | "mimeType" | "bytes" | "naturalWidth" | "naturalHeight" | "cloudStoragePath" | "cloudAssetId" | "creatorTaskId"
>;

export function imageAlternativeFromMetadata(metadata?: ImageMediaFields, alternativeId?: string): CanvasImageAlternative | null {
    if (!metadata) return null;
    const content = metadata.content?.trim();
    if (!content) return null;
    return {
        id: alternativeId || metadata.creatorTaskId || metadata.cloudAssetId || metadata.storageKey || content,
        content,
        storageKey: metadata.storageKey,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        cloudStoragePath: metadata.cloudStoragePath,
        cloudAssetId: metadata.cloudAssetId,
        creatorTaskId: metadata.creatorTaskId,
    };
}

export function readImageAlternatives(metadata?: CanvasNodeMetadata): CanvasImageAlternative[] {
    const alternatives = (metadata?.imageAlternatives || []).filter((alternative) => Boolean(alternative?.id && alternative.content));
    if (alternatives.length) return dedupeImageAlternatives(alternatives);
    const legacyAlternative = imageAlternativeFromMetadata(metadata);
    return legacyAlternative ? [legacyAlternative] : [];
}

export function appendImageAlternative(metadata: CanvasNodeMetadata | undefined, media: ImageMediaFields, alternativeId?: string) {
    // The new render must not inherit identity from the currently visible
    // image, otherwise a different generation could replace version one.
    const nextAlternative = imageAlternativeFromMetadata(media, alternativeId);
    const alternatives = readImageAlternatives(metadata);
    if (!nextAlternative) return { alternatives, activeImageAlternativeIndex: Math.max(0, alternatives.length - 1) };

    const existingIndex = alternatives.findIndex((alternative) => sameImageAlternative(alternative, nextAlternative));
    const nextAlternatives =
        existingIndex >= 0
            ? alternatives.map((alternative, index) => (index === existingIndex ? { ...alternative, ...nextAlternative, id: alternative.id } : alternative))
            : [...alternatives, nextAlternative];
    return {
        alternatives: nextAlternatives,
        activeImageAlternativeIndex: existingIndex >= 0 ? existingIndex : nextAlternatives.length - 1,
    };
}

export function imageAlternativeMetadata(alternative: CanvasImageAlternative): ImageMediaFields {
    return {
        content: alternative.content,
        storageKey: alternative.storageKey,
        mimeType: alternative.mimeType,
        bytes: alternative.bytes,
        naturalWidth: alternative.naturalWidth,
        naturalHeight: alternative.naturalHeight,
        cloudStoragePath: alternative.cloudStoragePath,
        cloudAssetId: alternative.cloudAssetId,
        creatorTaskId: alternative.creatorTaskId,
    };
}

export function activeImageAlternativeIndex(metadata?: CanvasNodeMetadata) {
    const alternatives = readImageAlternatives(metadata);
    if (!alternatives.length) return 0;
    const requested = metadata?.activeImageAlternativeIndex ?? alternatives.length - 1;
    return Math.min(Math.max(requested, 0), alternatives.length - 1);
}

function dedupeImageAlternatives(alternatives: CanvasImageAlternative[]) {
    return alternatives.reduce<CanvasImageAlternative[]>((deduped, alternative) => {
        const existingIndex = deduped.findIndex((candidate) => sameImageAlternative(candidate, alternative));
        if (existingIndex < 0) return [...deduped, alternative];
        const existing = deduped[existingIndex]!;
        return deduped.map((candidate, index) => (index === existingIndex ? { ...candidate, ...alternative, id: existing.id } : candidate));
    }, []);
}

function sameImageAlternative(left: CanvasImageAlternative, right: CanvasImageAlternative) {
    if (left.id === right.id) return true;
    if (left.creatorTaskId && left.creatorTaskId === right.creatorTaskId) return true;
    if (left.cloudAssetId && left.cloudAssetId === right.cloudAssetId) return true;
    if (left.cloudStoragePath && left.cloudStoragePath === right.cloudStoragePath) return true;
    if (left.storageKey && left.storageKey === right.storageKey) return true;
    return Boolean(left.content && left.content === right.content);
}
