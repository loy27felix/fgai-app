import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("legacy image and video workspaces participate in canvas version checks", () => {
  for (const file of [
    "components/creator/CreatorImageWorkspace.tsx",
    "components/creator/CreatorVideoWorkspace.tsx",
  ]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /expectedVersion:\s*canvas\.version/);
  }
});
