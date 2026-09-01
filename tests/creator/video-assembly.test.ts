import assert from "node:assert/strict";
import test from "node:test";

import { assemblyStoragePath, normalizeAssemblyTaskIds } from "@/lib/creator/video-assembly";

test("assembly input keeps only unique, bounded task identifiers in caller order", () => {
  const ids = normalizeAssemblyTaskIds([
    "11111111-1111-1111-1111-111111111111",
    "not a task id",
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);

  assert.deepEqual(ids, [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);
});

test("assembled video output is namespaced by the owner and production", () => {
  const target = assemblyStoragePath("user-1", "production-1", "job-1");
  assert.equal(target, "user-1/productions/production-1/assemblies/job-1.mp4");
});
