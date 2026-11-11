import { expect, test } from "bun:test";
import { resolve } from "node:path";
test("video first-frame previews stay lazy and do not reuse another account's cache", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/video-media-preview.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 10000 });
    expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0);
}, 15000);
