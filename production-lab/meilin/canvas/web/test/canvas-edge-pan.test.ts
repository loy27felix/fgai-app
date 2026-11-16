import { expect, test } from "bun:test";
import { canvasEdgePanVelocity } from "@/lib/canvas/canvas-edge-pan";

const rect = { left: 200, top: 80, right: 1400, bottom: 880 };
test("中央不平移，四边沿查看方向移动，靠边更快", () => {
    expect(canvasEdgePanVelocity({ x: 800, y: 480 }, rect)).toEqual({ x: 0, y: 0 });
    const left = canvasEdgePanVelocity({ x: 200, y: 480 }, rect);
    const right = canvasEdgePanVelocity({ x: 1400, y: 480 }, rect);
    expect(left.x).toBe(720);
    expect(right.x).toBe(-720);
    expect(canvasEdgePanVelocity({ x: 800, y: 80 }, rect).y).toBe(720);
    expect(canvasEdgePanVelocity({ x: 800, y: 880 }, rect).y).toBe(-720);
    expect(canvasEdgePanVelocity({ x: 236, y: 480 }, rect).x).toBeLessThan(left.x);
});
test("对角速度受限，离开窗口后停止，小窗口没有反向重叠热区", () => {
    const diagonal = canvasEdgePanVelocity({ x: 200, y: 80 }, rect);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(720);
    expect(canvasEdgePanVelocity({ x: 100, y: 480 }, rect)).toEqual({ x: 0, y: 0 });
    expect(canvasEdgePanVelocity({ x: 50, y: 50 }, { left: 0, top: 0, right: 100, bottom: 100 })).toEqual({ x: 0, y: 0 });
});
