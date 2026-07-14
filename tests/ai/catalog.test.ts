import assert from 'node:assert/strict';
import test from 'node:test';
import { TEXT_MODELS, resolveTextModel } from '../../lib/ai/catalog';

test('catalog exposes the exact supported text models in UI order', () => {
  assert.deepEqual(
    TEXT_MODELS.map(({ id, provider, supportsImages }) => ({ id, provider, supportsImages })),
    [
      { id: 'deepseek-flash', provider: 'deepseek', supportsImages: false },
      { id: 'deepseek-pro', provider: 'deepseek', supportsImages: false },
      { id: 'gpt-5.6-luna', provider: 'wetoken', supportsImages: true },
      { id: 'gpt-5.6-terra', provider: 'wetoken', supportsImages: true },
      { id: 'gpt-5.6-sol', provider: 'wetoken', supportsImages: true },
      { id: 'claude-opus-4-8', provider: 'wetoken', supportsImages: true },
    ],
  );
});

test('resolver falls back to DeepSeek Flash', () => {
  assert.equal(resolveTextModel('missing').id, 'deepseek-flash');
  assert.equal(resolveTextModel().id, 'deepseek-flash');
});
