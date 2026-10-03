import { createAgentRuntimeServer } from "./server.js";
import { PiModelAdapter } from "./pi-model-adapter.js";
import { PythonInternalClient } from "./python-internal-client.js";
import { SkillBundleError } from "./skills.js";
import { startVerifiedServer } from "./startup.js";

const token = process.env.AGENT_RUNTIME_INTERNAL_TOKEN?.trim();
if (!token) {
  throw new Error("AGENT_RUNTIME_INTERNAL_TOKEN is required.");
}
const mode = process.env.AGENT_RUNTIME_MODE === "fake" ? "fake" : "real";
if (mode === "fake" && process.env.NODE_ENV === "production") {
  throw new Error("Fake Agent runtime mode is forbidden in production.");
}

const host = process.env.AGENT_RUNTIME_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.AGENT_RUNTIME_PORT ?? "8765", 10);
const pythonBaseUrl = process.env.AGENT_RUNTIME_PYTHON_BASE_URL?.trim() || "http://127.0.0.1:8000";
const adapter =
  mode === "real"
    ? new PiModelAdapter(
        new PythonInternalClient({
          baseUrl: pythonBaseUrl,
          internalToken: token,
        }),
      )
    : undefined;
const server = createAgentRuntimeServer({
  internalToken: token,
  mode,
  maxConcurrentRuns: 100,
  ...(adapter ? { adapter } : {}),
});
// Keep native Pi tools and skill verification; isolate callback paths by workspace.
if (process.env.FG_ADCRAFT_MODE === 'true') {
  const original = server.listeners('request');
  server.removeAllListeners('request');
  const workspaces = new Map<string, ReturnType<typeof createAgentRuntimeServer>>();
  server.on('request', (req, res) => {
    const match = /^\/w\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(\/internal\/v1\/.*)$/.exec(req.url || '');
    if (!match) { if (req.url !== '/internal/v1/health') { res.writeHead(404); res.end(); return; } original.forEach(listener => listener.call(server, req, res)); return; }
    const workspace = match[1]!;
    let scoped = workspaces.get(workspace);
    if (!scoped) { scoped = createAgentRuntimeServer({ internalToken: token, mode, maxConcurrentRuns: 100, adapter: new PiModelAdapter(new PythonInternalClient({ baseUrl: pythonBaseUrl + '/w/' + workspace, internalToken: token })) }); workspaces.set(workspace, scoped); }
    req.url = match[2]!; scoped.emit('request', req, res);
  });
}
await startVerifiedServer(server, port, host).catch((error: unknown) => {
  const code =
    error instanceof SkillBundleError
      ? error.code
      : "agent_runtime_startup_failed";
  console.error(`Agent runtime startup failed: ${code}.`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
