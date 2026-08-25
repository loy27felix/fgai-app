import assert from 'node:assert/strict';
import test from 'node:test';
import { TEXT_MODELS, resolveTextModel } from '../../lib/ai/catalog';

test('catalog exposes the exact supported Wetoken text models in UI order', () => {
  assert.deepEqual(
    TEXT_MODELS.map(({ id, provider, supportsImages }) => ({ id, provider, supportsImages })),
    [
      { id: 'gpt-5.6-luna-t1a', provider: 'wetoken', supportsImages: true },
      { id: 'gpt-5.6-terra-t1a', provider: 'wetoken', supportsImages: true },
      { id: 'claude-sonnet-5', provider: 'wetoken', supportsImages: true },
      { id: 'claude-opus-5', provider: 'wetoken', supportsImages: true },
      { id: 'deepseek-v4-pro', provider: 'wetoken', supportsImages: false },
    ],
  );
});

test('resolver falls back to GPT-5.6 Luna T1A', () => {
  assert.equal(resolveTextModel('missing').id, 'gpt-5.6-luna-t1a');
  assert.equal(resolveTextModel().id, 'gpt-5.6-luna-t1a');
});
