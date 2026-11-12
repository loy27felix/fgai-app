import { expect, test } from "bun:test";
test("reasoning preference lifecycle", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-reasoning-preference.harness.tsx"], { cwd: import.meta.dir + "/..", timeout: 30000 });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}, 35000);
