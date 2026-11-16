import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("FG workspace renders the selected interface language", () => {
    const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/fg-workspace-locale.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        timeout: 15_000,
    });
    const output = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
    expect(run.exitCode, output).toBe(0);
}, 20_000);
