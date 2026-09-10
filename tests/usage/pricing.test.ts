import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextLedgerEntry } from '../../lib/usage/ledger';

test('configured text usage stores the shared WeToken catalog snapshot', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-priced',
    userId: 'user-1',
    provider: 'wetoken',
    model: 'deepseek-v4-pro',
    usage: { prompt_tokens: 7, completion_tokens: 64, total_tokens: 71 },
  });

  assert.equal(row.cost_source, 'estimated');
  assert.equal(row.estimated_cost_usd, 0.000324);
  assert.equal(row.price_snapshot.pricing_version, 'wetoken-account-2026-09-10');
  assert.equal(row.price_snapshot.raw_input_per_million_usd, 2.4);
  assert.equal(row.price_snapshot.raw_output_per_million_usd, 4.8);
});
