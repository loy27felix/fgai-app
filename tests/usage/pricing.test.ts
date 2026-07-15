import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextLedgerEntry } from '../../lib/usage/ledger';

test('DeepSeek Flash usage stores a conservative cache-miss cost snapshot', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-priced',
    userId: 'user-1',
    provider: 'deepseek',
    model: 'deepseek-flash',
    usage: { prompt_tokens: 7, completion_tokens: 64, total_tokens: 71 },
  });

  assert.equal(row.cost_source, 'estimated');
  assert.equal(row.estimated_cost_usd, 0.0000189);
  assert.deepEqual(row.price_snapshot, {
    currency: 'USD',
    unit: '1M tokens',
    input_per_million: 0.14,
    output_per_million: 0.28,
    assumption: 'cache_miss',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  });
});
