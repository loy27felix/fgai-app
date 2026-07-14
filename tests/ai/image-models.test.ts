import assert from 'node:assert/strict';
import test from 'node:test';
import { IMG_MODELS, sizeFor } from '../../lib/imageModels';

test('image catalog contains exactly the requested Wetoken models', () => {
  assert.deepEqual(IMG_MODELS.map((model) => model.id), [
    'gpt-image-2',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-image',
  ]);
  assert.deepEqual(IMG_MODELS.map((model) => model.provider), [
    'gpt-image',
    'gemini',
    'gemini',
    'gemini',
  ]);
  assert.deepEqual(IMG_MODELS.map((model) => model.experimental), [false, false, true, true]);
});

test('sizeFor keeps supported ratio dimensions stable', () => {
  assert.equal(sizeFor('gpt-image-2', '16:9'), '1536x864');
  assert.equal(sizeFor('gemini-3-pro-image-preview', '9:16'), '768x1344');
  assert.equal(sizeFor('unknown', 'unknown'), '1024x1024');
});
