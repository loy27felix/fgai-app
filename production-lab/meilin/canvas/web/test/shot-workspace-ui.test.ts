import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("real shot workbench retains per-shot editing and applies a rewrite after polling", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/shot-workspace-ui.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35000);
