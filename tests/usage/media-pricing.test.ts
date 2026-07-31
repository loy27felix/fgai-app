import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateImagePrice, estimateVideoPrice } from '../../lib/usage/pricing';
import { usdToCny } from '../../lib/usage/fx';

test('matches the supplied Wetoken billing snapshot for image and Seedance rows', () => {
  assert.equal(estimateImagePrice('gpt-image-2', '1024x1024')?.estimatedCostUsd, 0.015);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 6, resolution: '720p' })?.estimatedCostUsd, 0.913501);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0-filter-off', duration: 6, resolution: '720p' })?.estimatedCostUsd, 0.913501);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 15, resolution: '4K' })?.estimatedCostUsd, 11.696721);
});

test('keeps unobserved media combinations unpriced', () => {
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0-fast', duration: 6, resolution: '720p' }), null);
  assert.equal(estimateImagePrice('gemini-3-pro-image-preview', '1024x1024'), null);
});

test('converts the four supplied rows with a configurable display rate', () => {
  const usd = 0.015 + 0.913501 + 0.913501 + 11.696721;
  assert.equal(Number(usd.toFixed(6)), 13.538723);
  assert.equal(usdToCny(usd, 6.77), 91.657155);
});