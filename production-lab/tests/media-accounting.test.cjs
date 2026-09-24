const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLabMediaAccounting } = require('./.build/media-accounting.js');

test('only an exact WeToken Reference ID from the fee CSV is shown as settled cost', () => {
  const matched = resolveLabMediaAccounting('wetoken-ref-1', {
    provider_request_id: 'wetoken-ref-1', reported_cost_usd: '0.42', estimated_cost_usd: '0.36', status: 'succeeded',
    price_snapshot: { reconciliation_source: 'wetoken_fee_log_csv' },
  });
  assert.equal(matched.reconciled, true);
  assert.equal(matched.settledUsd, '0.42');
  assert.equal(matched.status, '已按 WeToken Reference ID 对账');

  const mismatch = resolveLabMediaAccounting('wetoken-ref-1', {
    provider_request_id: 'different-ref', reported_cost_usd: '0.99', price_snapshot: { reconciliation_source: 'wetoken_fee_log_csv' },
  }, '0.36', '0.50');
  assert.equal(mismatch.reconciled, false);
  assert.equal(mismatch.settledUsd, null);
  assert.equal(mismatch.reportedUsd, null);
  assert.equal(mismatch.estimateUsd, '0.36');

  const pending = resolveLabMediaAccounting('wetoken-ref-1', {
    provider_request_id: 'wetoken-ref-1', reported_cost_usd: '0.37', estimated_cost_usd: '0.36',
    price_snapshot: { reconciliation_source: 'model_price_snapshot' },
  });
  assert.equal(pending.reconciled, false);
  assert.equal(pending.reportedUsd, '0.37');
  assert.equal(pending.settledUsd, null);
});
