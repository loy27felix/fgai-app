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
    // `media` belongs to this run. Do not inherit the previous node's task ID:
    // doing so would treat a genuinely new render as the old version.
    const nextAlternative = videoAlternativeFromMetadata(media, alternativeId);
    const alternatives = readVideoAlternatives(metadata);
    if (!nextAlternative) return { alternatives, activeVideoAlternativeIndex: Math.max(0, alternatives.length - 1) };

    const existingIndex = alternatives.findIndex((alternative) => sameVideoAlternative(alternative, nextAlternative));
    const nextAlternatives =
        existingIndex >= 0
            ? alternatives.map((alternative, index) => (index === existingIndex ? { ...alternative, ...nextAlternative, id: alternative.id } : alternative))
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

export function activeVideoAlternativeIndex(metadata?: CanvasNodeMetadata) {
    const alternatives = readVideoAlternatives(metadata);
    if (!alternatives.length) return 0;
    const requested = metadata?.activeVideoAlternativeIndex ?? alternatives.length - 1;
    return Math.min(Math.max(requested, 0), alternatives.length - 1);
}

export function videoAlternativeVersionLabel(metadata?: CanvasNodeMetadata) {
    return `V${String(activeVideoAlternativeIndex(metadata) + 1).padStart(2, "0")}`;
}

export function videoAlternativeAssetTitle(title: string | undefined, metadata?: CanvasNodeMetadata) {
    return `${safeVideoFileBase(title)} · ${videoAlternativeVersionLabel(metadata)}`;
}

export function videoAlternativeFileName(title: string | undefined, metadata?: CanvasNodeMetadata) {
    const alternatives = readVideoAlternatives(metadata);
    const activeAlternative = alternatives[activeVideoAlternativeIndex(metadata)];
    const extension = videoExtension(activeAlternative?.mimeType || metadata?.mimeType);
    return `${safeVideoFileBase(title)}-v${String(activeVideoAlternativeIndex(metadata) + 1).padStart(2, "0")}.${extension}`;
}

function dedupeVideoAlternatives(alternatives: CanvasVideoAlternative[]) {
    return alternatives.reduce<CanvasVideoAlternative[]>((deduped, alternative) => {
        const existingIndex = deduped.findIndex((candidate) => sameVideoAlternative(candidate, alternative));
        if (existingIndex < 0) return [...deduped, alternative];
        const existing = deduped[existingIndex]!;
        return deduped.map((candidate, index) => (index === existingIndex ? { ...candidate, ...alternative, id: existing.id } : candidate));
    }, []);
}

function sameVideoAlternative(left: CanvasVideoAlternative, right: CanvasVideoAlternative) {
    if (left.id === right.id) return true;
    if (left.creatorTaskId && left.creatorTaskId === right.creatorTaskId) return true;
    if (left.externalTaskId && left.externalTaskId === right.externalTaskId) return true;
    if (left.cloudAssetId && left.cloudAssetId === right.cloudAssetId) return true;
    if (left.cloudStoragePath && left.cloudStoragePath === right.cloudStoragePath) return true;
    if (left.storageKey && left.storageKey === right.storageKey) return true;
    return Boolean(left.content && left.content === right.content);
}

function safeVideoFileBase(title?: string) {
    const sanitized = (title || "canvas-video")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/[\u0000-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "")
        .trim()
        .slice(0, 96);
    return sanitized || "canvas-video";
}

function videoExtension(mimeType?: string) {
    if (mimeType?.includes("webm")) return "webm";
    if (mimeType?.includes("quicktime") || mimeType?.includes("mov")) return "mov";
    if (mimeType?.includes("ogg")) return "ogv";
    return "mp4";
}
