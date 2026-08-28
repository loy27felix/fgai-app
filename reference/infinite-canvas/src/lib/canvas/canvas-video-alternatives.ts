import type { CanvasNodeMetadata, CanvasVideoAlternative } from "@/reference/infinite-canvas/src/types/canvas";

type VideoMediaFields = Pick<
    CanvasNodeMetadata,
    "content" | "storageKey" | "mimeType" | "bytes" | "naturalWidth" | "naturalHeight" | "durationMs" | "cloudStoragePath" | "cloudAssetId" | "externalTaskId" | "creatorTaskId"
>;

export function videoAlternativeFromMetadata(metadata?: VideoMediaFields, alternativeId?: string): CanvasVideoAlternative | null {
    if (!metadata) return null;
    const content = metadata.content?.trim();
    if (!content) return null;
    return {
        id: alternativeId || metadata.creatorTaskId || metadata.externalTaskId || content,
        content,
        storageKey: metadata.storageKey,
        mimeType: metadata.mimeType,
        bytes: metadata.bytes,
        naturalWidth: metadata.naturalWidth,
        naturalHeight: metadata.naturalHeight,
        durationMs: metadata.durationMs,
        cloudStoragePath: metadata.cloudStoragePath,
        cloudAssetId: metadata.cloudAssetId,
        externalTaskId: metadata.externalTaskId,
        creatorTaskId: metadata.creatorTaskId,
    };
}

export function readVideoAlternatives(metadata?: CanvasNodeMetadata): CanvasVideoAlternative[] {
    const alternatives = (metadata?.videoAlternatives || []).filter((alternative) => Boolean(alternative?.id && alternative.content));
    if (alternatives.length) return dedupeVideoAlternatives(alternatives);
    const legacyAlternative = videoAlternativeFromMetadata(metadata);
    return legacyAlternative ? [legacyAlternative] : [];
}

export function appendVideoAlternative(metadata: CanvasNodeMetadata | undefined, media: VideoMediaFields, alternativeId?: string) {
    const nextAlternative = videoAlternativeFromMetadata({ ...metadata, ...media }, alternativeId);
    const alternatives = readVideoAlternatives(metadata);
    if (!nextAlternative) return { alternatives, activeVideoAlternativeIndex: Math.max(0, alternatives.length - 1) };

    const existingIndex = alternatives.findIndex((alternative) => alternative.id === nextAlternative.id);
    const nextAlternatives =
        existingIndex >= 0
            ? alternatives.map((alternative, index) => (index === existingIndex ? { ...alternative, ...nextAlternative } : alternative))
            : [...alternatives, nextAlternative];
    return {
        alternatives: nextAlternatives,
        activeVideoAlternativeIndex: existingIndex >= 0 ? existingIndex : nextAlternatives.length - 1,
    };
}

export function videoAlternativeMetadata(alternative: CanvasVideoAlternative): VideoMediaFields {
    return {
        content: alternative.content,
        storageKey: alternative.storageKey,
        mimeType: alternative.mimeType,
        bytes: alternative.bytes,
        naturalWidth: alternative.naturalWidth,
        naturalHeight: alternative.naturalHeight,
        durationMs: alternative.durationMs,
        cloudStoragePath: alternative.cloudStoragePath,
        cloudAssetId: alternative.cloudAssetId,
        externalTaskId: alternative.externalTaskId,
        creatorTaskId: alternative.creatorTaskId,
    };
}

function dedupeVideoAlternatives(alternatives: CanvasVideoAlternative[]) {
    const seen = new Set<string>();
    return alternatives.filter((alternative) => {
        if (seen.has(alternative.id)) return false;
        seen.add(alternative.id);
        return true;
    });
}
