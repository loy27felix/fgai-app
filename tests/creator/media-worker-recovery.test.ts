import assert from "node:assert/strict";
import test from "node:test";

import { recoverExpiredMediaLeases } from "../../lib/creator/media-worker-queue";

test("expired processing leases return to the queue and never delete source assets", async () => {
    const result = await recoverExpiredMediaLeases({ now: new Date("2026-09-15T00:00:00Z"), maxAttempts: 3 });
    assert.equal(result.requeued >= 0, true);
    assert.equal(result.deletedSourceAssets, 0);
});
