import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("截图切换焦点和 Escape 后真实提示词弹窗仍可编辑，显式关闭后画布快捷键恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/prompt-editor-capture.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0);
}, 25000);
