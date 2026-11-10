import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("canvas timeline preview plays audio without a video track", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-timeline-audio.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 10000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 12000);
