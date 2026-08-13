import assert from 'node:assert/strict';
import test from 'node:test';
import { billingStateFor, summarizeUsageRows, withEligibleCatalogEstimate } from '../../lib/usage/reporting';

test('usage reporting keeps confirmed provider cost separate from quota estimates', () => {
  const rows = [
    {
      status: 'succeeded', kind: 'video', total_tokens: 0, image_count: 0, video_seconds: 15,
      duration_ms: 1200, reported_cost_usd: 11.696721, estimated_cost_usd: 11.696721,
    },
    {
      status: 'submitted', kind: 'video', total_tokens: 0, image_count: 0, video_seconds: 15,
      duration_ms: 0, reported_cost_usd: null, estimated_cost_usd: 11.696721,
    },
    {
      status: 'succeeded', kind: 'video', total_tokens: 0, image_count: 0, video_seconds: 15,
      duration_ms: 0, reported_cost_usd: null, estimated_cost_usd: null,
    },
    {
      status: 'failed', kind: 'video', total_tokens: 0, image_count: 0, video_seconds: 15,
      duration_ms: 0, reported_cost_usd: null, estimated_cost_usd: 11.696721,
    },
  ];

  const summary = summarizeUsageRows(rows);
  assert.equal(summary.calls, 4);
  assert.equal(summary.chargeableCalls, 3);
  assert.equal(summary.failedCalls, 1);
  assert.equal(summary.confirmedCostUsd, 11.696721);
  assert.equal(summary.estimatedCostUsd, 11.696721);
  assert.equal(summary.quotaReservedUsd, 23.393442);
  assert.equal(summary.unpricedCalls, 1);
});

test('a failed estimate is never presented as a charge', () => {
  assert.equal(billingStateFor({ status: 'failed', reported_cost_usd: null, estimated_cost_usd: 11.696721 }), 'failed');
  assert.equal(billingStateFor({ status: 'unknown', reported_cost_usd: null, estimated_cost_usd: null }), 'unpriced');
  assert.equal(billingStateFor({ status: 'submitted', reported_cost_usd: null, estimated_cost_usd: 0.913501 }), 'estimated');
  assert.equal(billingStateFor({ status: 'succeeded', reported_cost_usd: 0.913501, estimated_cost_usd: 0.913501 }), 'confirmed');
});

test('known successful media is priced immediately when the provider omits cost', () => {
  const image = withEligibleCatalogEstimate({
    status: 'succeeded', kind: 'image', model: 'gpt-image-2', resolution: '1024x1024',
    reported_cost_usd: null, estimated_cost_usd: null,
  });
  const video = withEligibleCatalogEstimate({
    status: 'succeeded', kind: 'video', model: 'doubao-seedance-2-0', resolution: '720p', video_seconds: 6,
    reported_cost_usd: null, estimated_cost_usd: null,
  });
  assert.equal(image.estimated_cost_usd, 0.015);
  assert.equal(video.estimated_cost_usd, 0.913501);
});

test('historical known media receives the same price for a real-time dashboard total', () => {
  const rows = [
    { status: 'succeeded', kind: 'image', model: 'gpt-image-2', resolution: '1024x1024', reported_cost_usd: null, estimated_cost_usd: null },
    { status: 'succeeded', kind: 'video', model: 'doubao-seedance-2-0', resolution: '720p', video_seconds: 6, reported_cost_usd: null, estimated_cost_usd: null },
  ].map(withEligibleCatalogEstimate);
  const summary = summarizeUsageRows(rows);
  assert.equal(summary.confirmedCostUsd, 0);
  assert.equal(summary.estimatedCostUsd, 0.928501);
  assert.equal(summary.quotaReservedUsd, 0.928501);
});
