export type CanvasEdgePanPoint = { x: number; y: number };
export type CanvasEdgePanBounds = { left: number; top: number; right: number; bottom: number };

export const CANVAS_EDGE_PAN_ZONE = 72;
export const CANVAS_EDGE_PAN_MAX_STEP = 24;

/**
 * Returns the per-frame viewport motion for a pointer near a canvas edge.
 * Viewport movement is intentionally the opposite of the pointer edge so the
 * user reveals more world space in the direction they are dragging.
 */
export function getCanvasEdgeAutoPanDelta(point: CanvasEdgePanPoint, bounds: CanvasEdgePanBounds, zone = CANVAS_EDGE_PAN_ZONE, maxStep = CANVAS_EDGE_PAN_MAX_STEP) {
    if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return { x: 0, y: 0 };

    const velocity = (distance: number) => Math.round(maxStep * Math.pow(Math.max(0, 1 - distance / zone), 2));
    const leftDistance = point.x - bounds.left;
    const rightDistance = bounds.right - point.x;
    const topDistance = point.y - bounds.top;
    const bottomDistance = bounds.bottom - point.y;

    return {
        x: leftDistance < zone ? velocity(leftDistance) : rightDistance < zone ? -velocity(rightDistance) : 0,
        y: topDistance < zone ? velocity(topDistance) : bottomDistance < zone ? -velocity(bottomDistance) : 0,
    };
}
