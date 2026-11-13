import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Live2D settings: selectable admin mode, model choice, cancellation and personal save", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/live2d-import-settings.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 35000);
