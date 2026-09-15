import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("local worker rollout checklist names every durable boundary", () => {
    const runbook = fs.readFileSync("docs/local-media-worker.md", "utf8");
    ["配对", "租约", "NAS", "SHA-256", "重试", "WeToken"].forEach((term) => assert.match(runbook, new RegExp(term, "i")));
});
