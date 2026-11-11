import { expect, test } from "bun:test";

test("storyboard modal reviews per-attempt references before a single confirmed submission", async () => {
    const child = Bun.spawn([process.execPath, "run", "test/helpers/shot-image-modal.worker.tsx"], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result).toEqual({ confirmedOnlyAfterReview: true, perAttemptDeselection: true, invalidatedOnChange: true, doubleClickProtected: true, originalBindingsIntact: true, paidCalls: 0 });
}, 20_000);
