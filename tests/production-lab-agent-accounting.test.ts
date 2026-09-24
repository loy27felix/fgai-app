import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionAgentLedgerEntry, PRODUCTION_LAB_AGENT_LEDGER_SOURCE } from "../lib/production-lab/agent-accounting";

test("production Agent text calls are tagged and priced from known WeToken token usage", () => {
  const row = buildProductionAgentLedgerEntry({
    requestId: "b7f5fb28-331d-4c67-ae3b-ed9d2bfef587",
    providerRequestId: "WT-REF-1",
    userId: "user-1",
    projectId: "project-1",
    model: "gpt-5.6-luna-t1a",
    usage: { prompt_tokens: 1_000, completion_tokens: 500, cached_tokens: 100, total_tokens: 1_500 },
    durationMs: 250,
  });

  assert.equal(row.kind, "text");
  assert.equal(row.provider_request_id, "WT-REF-1");
  assert.equal(row.project_id, "project-1");
  assert.equal(row.cost_source, "estimated");
  assert.equal(row.estimated_cost_usd, 0.000782);
  assert.equal(row.price_snapshot.production_lab_source, PRODUCTION_LAB_AGENT_LEDGER_SOURCE);
});

test("Agent usage without a recognized model price or token details remains unknown, never zero", () => {
  const row = buildProductionAgentLedgerEntry({
    requestId: "63dc4d45-94d9-4e4f-9e5f-bce74cbcecf2",
    userId: "user-1",
    projectId: "project-1",
    model: "gpt-5.6-luna",
    durationMs: 250,
  });

  assert.equal(row.cost_source, "unknown");
  assert.equal(row.estimated_cost_usd, undefined);
  assert.equal(row.price_snapshot.production_lab_source, PRODUCTION_LAB_AGENT_LEDGER_SOURCE);
});
