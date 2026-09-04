import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

function hasValue(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

// A blank Video node is a valid draft. Only enter the lost-local-copy state
// when its saved metadata proves that it previously represented an output.
export function hasMaterializedVideoOutput(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Video) return false;
    const metadata = node.metadata;
    return metadata?.status === "success"
        || hasValue(metadata?.content)
        || hasValue(metadata?.storageKey)
        || hasValue(metadata?.cloudStoragePath)
        || hasValue(metadata?.cloudAssetId)
        || Boolean(metadata?.videoAlternatives?.some((alternative) =>
            hasValue(alternative.content)
            || hasValue(alternative.storageKey)
            || hasValue(alternative.cloudStoragePath)
            || hasValue(alternative.cloudAssetId),
        ));
}

export function shouldReportMissingVideoBackup(node: CanvasNodeData) {
    if (!hasMaterializedVideoOutput(node) || hasValue(node.metadata?.content)) return false;
    // A creator task can still be queried after a temporary network failure.
    // Do not replace that recoverable pending state with a misleading local
    // backup error.
    return !hasValue(node.metadata?.creatorTaskId) && !hasValue(node.metadata?.externalTaskId);
}
