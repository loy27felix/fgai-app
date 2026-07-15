import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEstimatedCost } from '../../lib/usage/cost';

test('calculates text cost from input and output tokens', () => {
  assert.equal(
    calculateEstimatedCost(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      { currency: 'USD', inputTokenUsdPerMillion: '2', outputTokenUsdPerMillion: '8' },
    ),
    '6.0000000000',
  );
});

test('adds fixed image and video unit prices without binary float drift', () => {
  assert.equal(
    calculateEstimatedCost(
      { imageCount: 2, videoSeconds: 5 },
      { currency: 'USD', imageUsdEach: '0.125', videoUsdPerSecond: '0.08' },
    ),
    '0.6500000000',
  );
});

test('returns zero when no priced measurement is present', () => {
  assert.equal(calculateEstimatedCost({}, { currency: 'USD' }), '0.0000000000');
});
