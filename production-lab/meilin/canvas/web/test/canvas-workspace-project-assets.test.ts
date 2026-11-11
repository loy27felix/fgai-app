import { expect, test } from "bun:test";

test("linked canvas defaults to project assets and inserts the current project character", async () => {
    const child = Bun.spawn([process.execPath, "test/helpers/canvas-workspace-project-assets.worker.tsx"], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr: code ? stderr : undefined }).toEqual({ code: 0, stderr: undefined });
    expect(stdout).toContain('"projectScopedInsertion":true');
}, 30000);
