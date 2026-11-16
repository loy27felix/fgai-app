import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { startupChunks } from "./build/startup-chunks";
import { resilientPreload } from "./build/resilient-preload";

const webDir = dirname(fileURLToPath(import.meta.url));
const appVersion = process.env.CANVAS_BUILD_VERSION?.trim() || readFileSync(resolve(webDir, "../VERSION"), "utf8").trim();
function git(args: string[]) {
    try { return execFileSync("git", args, { cwd: webDir, timeout: 1500, maxBuffer: 128 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return undefined; }
}
const checkoutCommit = git(["rev-parse", "--verify", "HEAD^{commit}"]);
const buildCommit = process.env.CANVAS_BUILD_COMMIT?.trim() || process.env.VITE_BUILD_COMMIT?.trim() || checkoutCommit || "unknown";
const buildTime = process.env.CANVAS_BUILD_TIME?.trim() || process.env.VITE_BUILD_TIME?.trim() || "unknown";
const appChangelog = readFileSync(resolve(webDir, "../FG-CHANGELOG.md"), "utf8");
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8080";

function runtimeVersionPlugin(command: "build" | "serve"): Plugin {
    const status = git(["status", "--porcelain", "--untracked-files=all", "--", ".", "../director-desk", "../VERSION", "../FG-CHANGELOG.md", "../assets"]);
    const rawDirty = process.env.CANVAS_BUILD_DIRTY;
    const safe = (value: string) => /^[\w.+:/ -]{1,100}$/.test(value) ? value : "unknown";
    const manifest = JSON.stringify({ service: "meilin-web", build: {
        version: safe(appVersion), commit: /^[a-f0-9]{7,40}$/i.test(buildCommit) ? buildCommit.toLowerCase() : "unknown",
        buildTime: safe(buildTime), environment: command === "serve" ? "development" : "production",
        dirty: status !== undefined ? rawDirty === "true" || status !== "" || !!(checkoutCommit && !checkoutCommit.startsWith(buildCommit))
            : rawDirty === "true" ? true : rawDirty === "false" ? false : null,
    } });
    // The build asset and dev response use the same metadata as this Vite process, not FG's version.
    // 静态产物与开发响应来自本次 Vite 构建元数据，不借用 FG 主站版本。
    return {
        name: "meilin-runtime-version",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = request.url?.split("?", 1)[0];
                const base = server.config.base.replace(/\/$/, "");
                if (path !== "/.well-known/fg-runtime.json" && path !== `${base}/.well-known/fg-runtime.json`) return next();
                if (request.method !== "GET" && request.method !== "HEAD") { response.statusCode = 405; response.end(); return; }
                response.setHeader("Content-Type", "application/json; charset=utf-8");
                response.setHeader("Cache-Control", "no-store");
                response.setHeader("X-Content-Type-Options", "nosniff");
                response.end(request.method === "HEAD" ? undefined : manifest);
            });
        },
        generateBundle() { this.emitFile({ type: "asset", fileName: ".well-known/fg-runtime.json", source: manifest }); },
    };
}

export default defineConfig(({ command }) => {
    if (command === "build" && process.env.CANVAS_BUILD_VERSION?.trim() && !process.env.FG_CANVAS_BASE_PATH?.trim()) {
        throw new Error("发布构建必须明确设置 FG_CANVAS_BASE_PATH；FG 工作区请使用 bun run build:fg，避免资源路径错误导致白屏。");
    }
    return {
    base: process.env.FG_CANVAS_BASE_PATH || "/",
    plugins: [react(), runtimeVersionPlugin(command), resilientPreload(), startupChunks()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __APP_CHANGELOG__: JSON.stringify(appChangelog),
        "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
        "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(buildCommit),
        "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
    },
    server: {
        proxy: {
            "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
                xfwd: true,
            },
            "/oauth/linuxdo/callback": {
                target: apiProxyTarget,
                changeOrigin: true,
                xfwd: true,
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    build: {
        rolldownOptions: {
            output: {
                strictExecutionOrder: true,
                codeSplitting: {
                    // Keep route-level lazy imports isolated. Recursively merging dependencies
                    // pulls unrelated pages into the initial modulepreload graph.
                    includeDependenciesRecursively: false,
                    minSize: 40 * 1024,
                    groups: [
                        {
                            // Shared interop helpers must not be emitted into a route entry:
                            // AntD would import that entry back and execute its bootstrap early.
                            name: "vendor-babel-runtime",
                            minSize: 0,
                            test: /node_modules[\\/]@babel[\\/]runtime[\\/]/,
                            priority: 40,
                        },
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/](?:react(?:-dom|-router|-router-dom)?|scheduler|zustand|use-sync-external-store|@tanstack[\\/](?:query-core|react-query))[\\/]/,
                            priority: 30,
                        },
                        {
                            name: "vendor-icons",
                            test: /node_modules[\\/](?:lucide-react|@ant-design[\\/]icons)[\\/]/,
                            priority: 20,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 48 * 1024,
                        },
                        {
                            name: "vendor-antd",
                            test: /node_modules[\\/](?:antd|@ant-design|@rc-component|rc-[^\\/]+|dayjs)[\\/]/,
                            priority: 10,
                            entriesAware: true,
                            entriesAwareMergeThreshold: 80 * 1024,
                        },
                    ],
                },
            },
        },
    },
    };
});
