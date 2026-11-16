import type { Position } from "@/types/canvas";

/** Screen pixels per second: enter the edge gently, then accelerate toward it. */
export function canvasEdgePanVelocity(point: Position, rect: { left: number; top: number; right: number; bottom: number }): Position {
    if (point.x < rect.left - 24 || point.x > rect.right + 24 || point.y < rect.top - 24 || point.y > rect.bottom + 24) return { x: 0, y: 0 };
    const axis = (value: number, low: number, high: number) => {
        const band = Math.min(72, (high - low) / 4);
        if (band <= 0) return 0;
        const leading = Math.max(0, Math.min(1, (low + band - value) / band));
        const trailing = Math.max(0, Math.min(1, (value - high + band) / band));
        return 720 * (leading * leading - trailing * trailing);
    };
    const x = axis(point.x, rect.left, rect.right);
    const y = axis(point.y, rect.top, rect.bottom);
    const diagonal = x && y ? Math.SQRT1_2 : 1;
    return { x: x * diagonal, y: y * diagonal };
}
