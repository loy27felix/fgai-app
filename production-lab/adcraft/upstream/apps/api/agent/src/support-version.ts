import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

function loadBuild() {
  const build: {
    commit: string;
    version: string;
    buildTime: string;
    environment: string;
    dirty: boolean | null;
  } = { commit: "unknown", version: "unknown", buildTime: "unknown", environment: "unknown", dirty: null };
  try {
    const data = JSON.parse(readFileSync(
      process.env.ADCRAFT_AGENT_BUILD_FILE || "/app/adcraft-agent-build.json", "utf8",
    )) as Record<string, unknown>;
    if (typeof data.commit === "string" && /^[0-9a-fA-F]{7,40}$/.test(data.commit)) build.commit = data.commit;
    for (const key of ["version", "environment"] as const) {
      if (typeof data[key] === "string" && /^[A-Za-z0-9_.:@-]{1,160}$/.test(data[key])) build[key] = data[key];
    }
    if (typeof data.buildTime === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(data.buildTime)
        && Number.isFinite(Date.parse(data.buildTime))) build.buildTime = new Date(data.buildTime).toISOString();
    if (typeof data.dirty === "boolean") build.dirty = data.dirty;
  } catch {
    // Missing metadata is unknown, never the API or checkout's build identity.
    // 元数据缺失时保持 unknown，不能借用 API 或 checkout 的构建身份。
  }
  return build;
}

const build = loadBuild();

export function supportVersion(request: IncomingMessage, response: ServerResponse): boolean {
  if (new URL(request.url ?? "/", "http://agent-runtime.local").pathname !== "/internal/support/version") return false;
  const token = process.env.SUPPORT_BOT_NATIVE_READ_TOKEN ?? "";
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from("Bearer " + token);
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0
    && request.rawHeaders[index]?.toLowerCase() === "authorization").length;
  const authorized = token.length >= 32 && count === 1 && actual.length === expected.length
    && timingSafeEqual(actual, expected);
  const status = !authorized ? 401 : request.method !== "GET" ? 405 : 200;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(status === 200
    ? { service: "adcraft-agent", build }
    : { detail: status === 401 ? "Support access denied" : "Read-only endpoint",
        errorCode: status === 401 ? "support_access_denied" : "support_read_only" }));
  return true;
}
