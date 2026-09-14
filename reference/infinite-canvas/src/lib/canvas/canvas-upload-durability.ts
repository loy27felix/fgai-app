import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

function isUploadMediaNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
}

/**
 * Browser blob/IndexedDB media is an optimistic preview, not a cloud-canvas
 * asset.  Keep it out of the cloud graph until the private asset upload has
 * returned a durable path.
 */
export function isPendingCanvasMediaUpload(node: CanvasNodeData) {
    return isUploadMediaNode(node) && node.metadata?.durableUploadPending === true;
}

/** A failed upload must be re-uploaded, never retried as a paid generation. */
export function isFailedCanvasMediaUpload(node: CanvasNodeData) {
    return isUploadMediaNode(node) && node.metadata?.durableUploadFailed === true;
}
