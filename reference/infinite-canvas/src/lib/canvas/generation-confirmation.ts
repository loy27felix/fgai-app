import { emitCanvasEvent } from "@/reference/infinite-canvas/src/lib/canvas/canvas-event-bus";

export type CanvasGenerationConfirmationRequest = {
    nodeId: string;
    nodeTitle: string;
    mode: "image" | "video" | "text" | "audio";
    model: string;
    prompt: string;
    intercepted: boolean;
    resolve: (approved: boolean) => void;
};

/**
 * Lets an enabled behaviour plugin pause a normal canvas generation before the
 * provider request is sent. With no plugin installed/enabled this is a no-op,
 * preserving the current one-click workflow.
 */
export function requestCanvasGenerationConfirmation(input: Omit<CanvasGenerationConfirmationRequest, "intercepted" | "resolve">) {
    return new Promise<boolean>((resolve) => {
        const request: CanvasGenerationConfirmationRequest = {
            ...input,
            intercepted: false,
            resolve,
        };
        emitCanvasEvent("canvas:generation-confirmation", request);
        if (!request.intercepted) resolve(true);
    });
}
