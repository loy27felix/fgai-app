import type { CanvasNodeData, ViewportTransform } from "@/reference/infinite-canvas/src/types/canvas";

export type CanvasWorldRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

type ConnectionNode = Pick<CanvasNodeData, "position" | "width" | "height">;

/**
 * Return the conservative bounds of the cubic path used by ConnectionPath.
 * The control points only move horizontally, so the extrema are covered by
 * the endpoints and the two horizontal control points.
 */
export function connectionRenderBounds(from: ConnectionNode, to: ConnectionNode): CanvasWorldRect {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);

    return {
        left: Math.min(startX, endX, startX + curvature, endX - curvature),
        top: Math.min(startY, endY),
        right: Math.max(startX, endX, startX + curvature, endX - curvature),
        bottom: Math.max(startY, endY),
    };
}

/** Convert the screen viewport into the canvas world's coordinate space. */
export function canvasViewportWorldRect(viewport: ViewportTransform, width: number, height: number, padding = 0): CanvasWorldRect {
    const scale = Math.max(viewport.k, 0.0001);
    return {
        left: -viewport.x / scale - padding,
        top: -viewport.y / scale - padding,
        right: (Math.max(0, width) - viewport.x) / scale + padding,
        bottom: (Math.max(0, height) - viewport.y) / scale + padding,
    };
}

export function connectionIntersectsRect(from: ConnectionNode, to: ConnectionNode, rect: CanvasWorldRect, padding = 0) {
    const bounds = connectionRenderBounds(from, to);
    return bounds.right + padding >= rect.left
        && bounds.left - padding <= rect.right
        && bounds.bottom + padding >= rect.top
        && bounds.top - padding <= rect.bottom;
}
