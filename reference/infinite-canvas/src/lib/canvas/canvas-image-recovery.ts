import { CanvasNodeType, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

// A blank Image node is a valid canvas placeholder. Only label it as a lost
// image when saved metadata proves that it once had media to restore.
export function shouldReportMissingImageBackup(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image || node.metadata?.content) return false;
    return node.metadata?.status === "success"
        || Boolean(node.metadata?.storageKey || node.metadata?.cloudStoragePath || node.metadata?.creatorTaskId);
}
