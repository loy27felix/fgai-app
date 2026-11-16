import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, FG_CANVAS_BASE_PATH: "/fg-six/" };
for (const entry of ["typescript/bin/tsc", "vite/bin/vite.js"]) {
    const args = entry.startsWith("typescript") ? ["--noEmit"] : ["build"];
    // TypeScript 7's native launcher uses Node package imports. Run it with
    // Node even when this release script is launched by Bun.
    const runtime = entry.startsWith("typescript") ? "node" : process.execPath;
    const runtimeArgs = runtime === process.execPath && process.versions.bun ? ["--bun"] : [];
    const result = spawnSync(runtime, [...runtimeArgs, resolve(webDir, "node_modules", entry), ...args], {
        cwd: webDir, env, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

// Check the real output, including modulepreloads: a healthy container cannot
// detect a document whose scripts resolve to the main application's /assets/.
const html = readFileSync(resolve(webDir, "dist/index.html"), "utf8");
const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map((match) => match[1]);
if (!assets.some((url) => url.endsWith(".js")) || !assets.some((url) => url.endsWith(".css"))) {
    throw new Error("FG 发布产物缺少入口脚本或样式。");
}
for (const url of assets) {
    if (!url.startsWith("/fg-six/assets/") || !existsSync(resolve(webDir, "dist", url.slice("/fg-six/".length)))) {
        throw new Error(`FG 发布资源路径或文件错误: ${url}`);
    }
}
console.log(`FG 发布产物检查通过：${assets.length} 个入口资源均位于 /fg-six/assets/。`);
