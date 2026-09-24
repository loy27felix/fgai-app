import assert from "node:assert/strict";
import test from "node:test";
import { addCostLine, emptyCostBuckets, groupAtTime, visibleGroupSpendRows, type MembershipInterval } from "../lib/production-lab/admin-accounting";
import { resolveLabMediaAccounting } from "../lib/production-lab/media-accounting";

test("spending reports never double count invoice, provider report, estimate, and unknown requests", () => {
  const summary = emptyCostBuckets();
  addCostLine(summary, { settledUsd: "1.25", reportedUsd: "1.25", estimatedUsd: "1.5" });
  addCostLine(summary, { reportedUsd: 2, estimatedUsd: 3 });
  addCostLine(summary, { estimatedUsd: "0.4" });
  addCostLine(summary, {});
  assert.deepEqual(summary, { settledUsd: 1.25, reportedUsd: 2, estimatedUsd: 0.4, unknownCount: 1 });
});

test("reassigned members retain the group that applied when each request ran", () => {
  const history: MembershipInterval[] = [
    { userId: "u1", groupId: "g1", groupName: "小组1", assignedAt: "2026-09-01T00:00:00Z", unassignedAt: "2026-09-15T00:00:00Z" },
    { userId: "u1", groupId: "g2", groupName: "小组2", assignedAt: "2026-09-15T00:00:00Z", unassignedAt: null },
  ];
  assert.equal(groupAtTime(history, "u1", "2026-09-14T23:59:00Z")?.groupName, "小组1");
  assert.equal(groupAtTime(history, "u1", "2026-09-15T00:00:00Z")?.groupName, "小组2");
  assert.equal(groupAtTime(history, "unknown", "2026-09-15T00:00:00Z"), null);
});

test("spend view hides empty archived and unassigned rows but keeps current and historical groups", () => {
  const empty = { settledUsd: 0, reportedUsd: 0, estimatedUsd: 0, unknownCount: 0 };
  const rows = [
    { groupId: "current", name: "小组1", requests: 0, ...empty },
    { groupId: "archived-empty", name: "1", requests: 0, ...empty },
    { groupId: "archived-used", name: "旧组", requests: 1, ...empty },
    { groupId: "__unassigned__", name: "未归属小组", requests: 0, ...empty },
  ];
  const visible = visibleGroupSpendRows(rows, [
    { id: "current", archivedAt: null },
    { id: "archived-empty", archivedAt: "2026-09-20T00:00:00Z" },
    { id: "archived-used", archivedAt: "2026-09-20T00:00:00Z" },
  ]);
  assert.deepEqual(visible.map((row) => [row.name, row.archivedAt]), [
    ["小组1", null],
    ["旧组", "2026-09-20T00:00:00Z"],
  ]);
});

test("script and media fees settle only after an exact WeToken Reference ID match", () => {
  const importedLedger = {
    provider_request_id: "WT-REF-123",
    reported_cost_usd: "0.82",
    estimated_cost_usd: "0.75",
    price_snapshot: { reconciliation_source: "wetoken_fee_log_csv" },
  };
  const exact = resolveLabMediaAccounting("WT-REF-123", importedLedger, 0.7);
  assert.equal(exact.reconciled, true);
  assert.equal(exact.settledUsd, "0.82");

  const mismatch = resolveLabMediaAccounting("WT-REF-OTHER", importedLedger, 0.7);
  assert.equal(mismatch.reconciled, false);
  assert.equal(mismatch.settledUsd, null);
  assert.equal(mismatch.estimateUsd, "0.75");
});
