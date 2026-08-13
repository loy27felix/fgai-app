import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateImagePrice, estimateVideoPrice } from '../../lib/usage/pricing';
import { usdToCny } from '../../lib/usage/fx';

test('uses the supplied Wetoken image generation prices', () => {
  assert.equal(estimateImagePrice('gpt-image-2', '1024x1024')?.estimatedCostUsd, 0.02);
  assert.equal(estimateImagePrice('gemini-3-pro-image-preview', '1024x1024')?.estimatedCostUsd, 0.134);
  assert.equal(estimateImagePrice('gemini-3-pro-image-preview', '4K')?.estimatedCostUsd, 0.24);
  assert.equal(estimateImagePrice('gemini-3.1-flash-image-preview', '1024x1024')?.estimatedCostUsd, 0.067);
  assert.equal(estimateImagePrice('gemini-3.1-flash-image-preview', '4K')?.estimatedCostUsd, 0.151);
  assert.equal(estimateImagePrice('gemini-3.1-flash-lite-image', '1024x1024')?.estimatedCostUsd, 0.01525);
});

test('uses the supplied Seedance model rules and prorates the documented 5-second examples', () => {
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 5, resolution: '720p' })?.estimatedCostUsd, 4.97);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0-filter-off', duration: 6, resolution: '720p' })?.estimatedCostUsd, 5.964);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0-fast', duration: 5, resolution: '720p' })?.estimatedCostUsd, 4);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-0-mini', duration: 5, resolution: '720p' })?.estimatedCostUsd, 2.485);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 5, resolution: '720p' })?.estimatedCostUsd, 7.597);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5-filter-off', duration: 12, resolution: '480p' })?.estimatedCostUsd, 8.4744);
});

test('accepts the 4–30 second Seedance 2.5 range and rejects unsupported durations', () => {
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 30, resolution: '720p' })?.estimatedCostUsd, 45.582);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 31, resolution: '720p' }), null);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 3, resolution: '720p' }), null);
});

test('shows supplied estimates in the configured RMB display rate', () => {
  assert.equal(usdToCny(4.97, 6.77), 33.6469);
});
