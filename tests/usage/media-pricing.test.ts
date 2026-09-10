import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateImagePrice, estimateVideoPrice } from '../../lib/usage/pricing';
import { usdToCny } from '../../lib/usage/fx';

test('does not invent an account-specific per-image price from public list prices', () => {
  // Wetoken lists these as token ranges, fixed list prices, or starting
  // prices. None prove the discounted cost for this workspace's account.
  assert.equal(estimateImagePrice('gpt-image-2', '1024x1024'), null);
  assert.equal(estimateImagePrice('gemini-3-pro-image-preview', '4K'), null);
  assert.equal(estimateImagePrice('gemini-3.1-flash-image-preview', '1024x1024'), null);
  assert.equal(estimateImagePrice('gemini-3.1-flash-lite-image', '1024x1024'), null);
  assert.equal(estimateImagePrice('seedream-5-0-lite-260128', '1024x1024'), null);
  assert.equal(estimateImagePrice('dola-seedream-5-0-pro-260628', '4K'), null);
});

test('uses the official Seedance token formula and the current Wetoken account coefficient', () => {
  // 720p/16:9/30s has 648,000 tokens. At ¥70/M it is ¥45.36, and the
  // verified paid Wetoken bill for this exact no-video-input request is $5.901746.
  const seedance25 = estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 30, resolution: '720p', ratio: '16:9' });
  assert.equal(seedance25?.estimatedCostUsd, 5.901746);
  assert.equal(seedance25?.snapshot.pricing_basis, 'seedance_token_formula');
  assert.equal(seedance25?.snapshot.estimated_tokens, 648000);
  assert.equal(seedance25?.snapshot.token_price_cny_per_million, 70);
  assert.equal(seedance25?.snapshot.output_width, 1280);
  assert.equal(seedance25?.snapshot.output_height, 720);
  assert.equal(seedance25?.snapshot.output_fps, 24);
});

test('applies the documented Seedance 2.0, Fast, Mini, and 2.5 token rates at 720p', () => {
  // 5s × 1280 × 720 × 24 / 1024 = 108,000 output tokens.
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 5, resolution: '720p', ratio: '16:9' })?.estimatedCostUsd, 0.646382);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0-fast', duration: 5, resolution: '720p', ratio: '16:9' })?.estimatedCostUsd, 0.389937);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-0-mini', duration: 5, resolution: '720p', ratio: '16:9' })?.estimatedCostUsd, 0.129276);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5-filter-off', duration: 5, resolution: '720p', ratio: '16:9' })?.estimatedCostUsd, 0.983624);
});

test('accepts the 4–30 second Seedance 2.5 range and rejects unsupported durations', () => {
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 30, resolution: '720p' })?.estimatedCostUsd, 5.901746);
  assert.equal(estimateVideoPrice({ model: 'dreamina-seedance-2-5', duration: 31, resolution: '720p' }), null);
  assert.equal(estimateVideoPrice({ model: 'doubao-seedance-2-0', duration: 3, resolution: '720p' }), null);
});

test('does not invent an estimate when a video reference has an unknown billable duration', () => {
  assert.equal(estimateVideoPrice({
    model: 'dreamina-seedance-2-5', duration: 5, resolution: '720p', ratio: '16:9', hasVideoReference: true,
  }), null);
});

test('shows supplied estimates in the configured RMB display rate', () => {
  assert.equal(usdToCny(5.901746, 6.77), 39.95482);
});
