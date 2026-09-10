import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateImagePrice,
  estimateImageUsagePrice,
  estimateTextPrice,
  estimateVideoPrice,
  extractReportedCostUsd,
} from '../../lib/usage/pricing';
import { IMG_MODELS } from '../../lib/imageModels';
import { VIDEO_MODELS } from '../../lib/ai/video-models';

test('uses a concrete preflight estimate for every configured image model', () => {
  assert.equal(estimateImagePrice('seedream-5-0-lite-260128', '1024x1024')?.estimatedCostUsd, 0.03325);
  assert.equal(estimateImagePrice('dola-seedream-5-0-pro-260628', '1024x1024', { referenceCount: 1 })?.estimatedCostUsd, 0.048);
  assert.equal(estimateImagePrice('dola-seedream-5-0-pro-260628', '2048x2048', { referenceCount: 1 })?.estimatedCostUsd, 0.093);
  assert.equal(estimateImagePrice('gemini-3-pro-image-preview', '4K')?.estimatedCostUsd, 0.1680014);
  assert.equal(estimateImagePrice('gemini-3.1-flash-image-preview', '2K')?.estimatedCostUsd, 0.07070035);
  assert.equal(estimateImagePrice('gemini-3.1-flash-image-preview', '2K', { referenceCount: 1 })?.estimatedCostUsd, 0.07106995);
  assert.equal(estimateImagePrice('gpt-image-2', '1024x1024')?.estimatedCostUsd, 0.004899);
  assert.equal(estimateImagePrice('gemini-3.1-flash-lite-image', '1024x1024')?.estimatedCostUsd, 0.023960175);
});

test('settles usage-dependent image rules from returned usage instead of a fake fixed price', () => {
  const gemini = estimateImageUsagePrice({
    model: 'gemini-3.1-flash-image-preview',
    resolution: '2K',
    referenceCount: 2,
    usage: { promptTokenCount: 2_000 },
  });
  assert.equal(gemini?.estimatedCostUsd, 0.0714);

  const gpt = estimateImageUsagePrice({
    model: 'gpt-image-2',
    resolution: '1024x1024',
    usage: { prompt_tokens: 1_000, completion_tokens: 10_000 },
  });
  assert.equal(gpt?.estimatedCostUsd, 0.183);
  assert.equal(estimateImageUsagePrice({
    model: 'gpt-image-2',
    resolution: '1024x1024',
    referenceCount: 1,
    usage: { prompt_tokens: 1_000, completion_tokens: 10_000 },
  })?.estimatedCostUsd, 0.1880688);
});

test('uses WeToken USD Seedance rules and the paid 2.5 30-second regression sample', () => {
  const seedance25 = estimateVideoPrice({
    model: 'dreamina-seedance-2-5', duration: 30, resolution: '720p', ratio: '16:9',
  });
  assert.equal(seedance25?.estimatedCostUsd, 5.901746);
  assert.equal(seedance25?.snapshot.pricing_basis, 'seedance_output_token_formula');
  assert.equal(seedance25?.snapshot.estimated_tokens, 648000);
  assert.equal(seedance25?.snapshot.raw_token_price_cny_per_million, 70);
  assert.equal(seedance25?.snapshot.account_multiplier, 0.85);
  assert.equal(seedance25?.snapshot.raw_cost_cny, 45.36);
  assert.equal(estimateVideoPrice({
    model: 'doubao-seedance-2-0', duration: 5, resolution: '720p', ratio: '16:9',
  })?.estimatedCostUsd, 0.6463817048);
  assert.equal(estimateVideoPrice({
    model: 'doubao-seedance-2-0-fast', duration: 5, resolution: '720p', ratio: '16:9',
  })?.estimatedCostUsd, 0.6116655518);
  assert.equal(estimateVideoPrice({
    model: 'dreamina-seedance-2-0-mini', duration: 5, resolution: '720p', ratio: '16:9',
  })?.estimatedCostUsd, 0.3231908524);
  assert.equal(estimateVideoPrice({
    model: 'dreamina-seedance-2-5-filter-off', duration: 5, resolution: '720p', ratio: '16:9',
  })?.estimatedCostUsd, 0.9836243333);
});

test('uses HappyHorse and MiniMax capabilities with concrete video-reference estimates', () => {
  assert.equal(estimateVideoPrice({
    model: 'happyhorse-1.1-i2v', duration: 5, resolution: '720p',
  })?.estimatedCostUsd, 0.063);
  assert.equal(estimateVideoPrice({
    model: 'happyhorse-1.1-r2v', duration: 5, resolution: '1080p',
  })?.estimatedCostUsd, 0.081);
  assert.equal(estimateVideoPrice({
    model: 'MiniMax-H3', duration: 6, resolution: '768p', imageReferenceCount: 8,
  })?.estimatedCostUsd, 0.6);
  assert.equal(estimateVideoPrice({
    model: 'MiniMax-H3', duration: 6, resolution: '768p', hasVideoReference: true,
  })?.estimatedCostUsd, 0.48);
  assert.equal(estimateVideoPrice({
    model: 'MiniMax-H3', duration: 6, resolution: '768p', hasVideoReference: true, videoReferenceSeconds: 3,
  })?.estimatedCostUsd, 0.72);
  assert.equal(estimateVideoPrice({
    model: 'dreamina-seedance-2-5', duration: 5, resolution: '720p', ratio: '16:9', hasVideoReference: true,
  })?.estimatedCostUsd, 0.5901746);
});

test('uses the same text catalog for all configured text models', () => {
  assert.equal(estimateTextPrice({
    model: 'gpt-5.6-luna-t1a', inputTokens: 1_000, cachedInputTokens: 100, outputTokens: 500,
  })?.estimatedCostUsd, 0.000782);
  assert.equal(estimateTextPrice({
    model: 'claude-sonnet-5', inputTokens: 1_000, cachedInputTokens: 100, outputTokens: 500,
  })?.estimatedCostUsd, 0.005115);
  assert.equal(estimateTextPrice({
    model: 'deepseek-v4-pro', inputTokens: 1, outputTokens: 2,
  })?.estimatedCostUsd, 0.000012);
  assert.equal(estimateTextPrice({ model: 'not-configured', inputTokens: 1, outputTokens: 1 }), null);
});

test('normalizes explicit provider RMB charges without mislabelling them as USD', () => {
  assert.equal(extractReportedCostUsd({ cost: 45.36, currency: 'CNY' }), 45.36 / 6.77);
  assert.equal(extractReportedCostUsd({ cost_cny: '¥39.95' }), 39.95 / 6.77);
  assert.equal(extractReportedCostUsd({ cost: '$5.901746' }), 5.901746);
  assert.equal(extractReportedCostUsd({ data: { cost_usd: 5.901746 } }), 5.901746);
});

test('every model exposed by the canvas catalog resolves to a price rule', () => {
  for (const model of IMG_MODELS) {
    assert.ok(estimateImagePrice(model.id, '1024x1024'), `${model.id} must have an image price`);
  }
  for (const model of VIDEO_MODELS) {
    const resolution = model.id === 'MiniMax-H3' ? '768p' : '720p';
    assert.ok(estimateVideoPrice({
      model: model.id,
      duration: model.minDuration,
      resolution,
      ratio: '16:9',
    }), `${model.id} must have a video price`);
  }
});
