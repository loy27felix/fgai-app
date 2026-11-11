import { expect, test } from "bun:test";
import { createConnectionEdgePan } from "@/lib/canvas/canvas-connection-edge-pan";

test("a held connection keeps panning and reprojects its tip without more pointer events", () => {
    let viewport = { x: 0, y: 0, k: 0.5 };
    let pointer: { x: number; y: number } | null = { x: 1000, y: 300 };
    let queued: ((time: number) => void) | null = null;
    const tips: number[] = [];
    const commits: typeof viewport[] = [];
    const pan = createConnectionEdgePan({
        pointer: () => pointer,
        bounds: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }),
        viewport: () => viewport,
        preview: (next) => { viewport = next; },
        refresh: () => tips.push((pointer!.x - viewport.x) / viewport.k),
        commit: (next) => commits.push(next),
        requestFrame: (callback) => { queued = callback; return 1; },
        cancelFrame: () => { queued = null; },
    });
    const frame = (time: number) => { const next = queued; queued = null; next!(time); };
    pan.start(); frame(0); frame(16); frame(32);
    expect(viewport.x).toBeLessThan(-20);
    expect(tips.at(-1)).toBeGreaterThan(tips[0]);
    expect(commits).toHaveLength(0);
    pointer = { x: 500, y: 300 }; frame(48);
    const stoppedX = viewport.x; frame(64);
    expect(viewport.x).toBe(stoppedX);
    pan.stop();
    expect(queued).toBeNull();
    expect(commits).toHaveLength(1);
    pan.stop(); expect(commits).toHaveLength(1);
});

test("cancelled connection and quick-create menu stop the loop; a fresh session can restart", () => {
    let pointer: { x: number; y: number } | null = null;
    let queued: ((time: number) => void) | null = null;
    let moves = 0;
    const pan = createConnectionEdgePan({
        pointer: () => pointer,
        bounds: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }),
        viewport: () => ({ x: 0, y: 0, k: 1 }),
        preview: () => { moves++; }, refresh: () => {}, commit: () => {},
        requestFrame: (callback) => { queued = callback; return 1; }, cancelFrame: () => { queued = null; },
    });
    pan.start(); const first = queued!; queued = null; first(0);
    expect(queued).toBeNull(); expect(moves).toBe(0);
    pointer = { x: 0, y: 300 }; pan.start();
    expect(queued).not.toBeNull(); pan.stop(); expect(queued).toBeNull();
});
