import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { buildGenerationConfig } from "./canvas-project-generation";
import { canvasImageNodeDimensions } from "./canvas-reference-image-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export function buildAngleGenerationConfig(config: AiConfig, node: CanvasNodeData, params?: CanvasImageAngleParams): AiConfig {
    const selection = params?.outputSize;
    const source = { ...node, metadata: { ...node.metadata, ...(selection || { size: undefined }), imageSizeSource: selection ? "user" as const : "reference" as const } };
    return { ...buildGenerationConfig(config, source, "image", undefined, false, canvasImageNodeDimensions(node)), count: "1" };
}
