import { canvasEdgePanVelocity } from "./canvas-edge-pan";
import type { Position, ViewportTransform } from "@/types/canvas";

type Options = {
    pointer: () => Position | null;
    bounds: () => { left: number; top: number; right: number; bottom: number } | null;
    viewport: () => ViewportTransform;
    preview: (viewport: ViewportTransform) => void;
    refresh: () => void;
    commit: (viewport: ViewportTransform) => void;
    requestFrame: (callback: (time: number) => void) => number;
    cancelFrame: (id: number) => void;
};

/** One loop per held connection, including stationary pointers at an edge. */
export function createConnectionEdgePan(options: Options) {
    let frame: number | null = null;
    let previousTime: number | null = null;
    let moved = false;
    const stop = () => {
        if (frame !== null) options.cancelFrame(frame);
        frame = null;
        previousTime = null;
        if (moved) { moved = false; options.commit(options.viewport()); }
    };
    const tick = (now: number) => {
        frame = null;
        const pointer = options.pointer();
        const bounds = options.bounds();
        if (!pointer || !bounds) { stop(); return; }
        const seconds = previousTime === null ? 0 : Math.max(0, Math.min(32, now - previousTime)) / 1000;
        previousTime = now;
        const velocity = canvasEdgePanVelocity(pointer, bounds);
        if (seconds && (velocity.x || velocity.y)) {
            const viewport = options.viewport();
            options.preview({ ...viewport, x: viewport.x + velocity.x * seconds, y: viewport.y + velocity.y * seconds });
            moved = true;
            // Re-evaluate world coordinates and snap targets after the viewport.
            options.refresh();
        }
        frame = options.requestFrame(tick);
    };
    return { start: () => { if (frame === null) frame = options.requestFrame(tick); }, stop };
}
