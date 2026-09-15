import assert from "node:assert/strict";
import test from "node:test";
import { canWorkerMutateJob, nextStatusAfterFailure } from "../../lib/creator/media-worker-queue";

test("a leased job can be retried until the third failed attempt", () => {
  assert.deepEqual([1, 2, 3].map((attempt) => nextStatusAfterFailure(attempt, true)), ["retryable", "retryable", "failed"]);
  assert.equal(nextStatusAfterFailure(1, false), "failed");
});

test("only the owning worker with the current lease token can report progress", () => {
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() + 60_000 }, "w1", "l1"), true);
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() + 60_000 }, "w2", "l1"), false);
  assert.equal(canWorkerMutateJob({ workerId: "w1", leaseToken: "l1", leaseExpiresAt: Date.now() - 1 }, "w1", "l1"), false);
});

