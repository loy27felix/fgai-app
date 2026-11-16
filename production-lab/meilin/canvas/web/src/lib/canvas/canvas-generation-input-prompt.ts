import { buildCameraPrompt } from "@/lib/canvas/camera-prompt-library";
import { resolveCameraControl } from "@/lib/canvas/camera-control-preferences";
import { buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import type { CanvasGenerationMode, CanvasNodeData } from "@/types/canvas";

/** Keep queued input snapshots and immediate generation on the same prompt preparation path. */
export function canvasGenerationInputPrompt(node: CanvasNodeData | undefined, mode: CanvasGenerationMode, prompt: string) {
    let result = mode === "image" && node?.metadata?.portraitTexture ? buildPortraitTexturePrompt(prompt, node.metadata.portraitTexture) : prompt;
    const camera = mode === "image" ? resolveCameraControl(node?.metadata?.cameraControl) : undefined;
    if (camera?.enabled) {
        result += `\n${buildCameraPrompt({ cameraId: camera.camera, lensId: camera.lens, focalLengthMm: camera.focalLength, apertureF: camera.aperture })}`;
    }
    return result;
}
