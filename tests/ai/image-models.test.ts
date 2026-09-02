import assert from 'node:assert/strict';
import test from 'node:test';
import { imageDraftGeometry, IMG_MODELS, ratioForImageSize, sizeFor } from '../../lib/imageModels';

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

test('ratioForImageSize retains the ratio of exact 2K and 4K presets', () => {
  assert.equal(ratioForImageSize('2048x1152'), '16:9');
  assert.equal(ratioForImageSize('2160x3840'), '9:16');
  assert.deepEqual(imageDraftGeometry('2048x1152'), { ratio: '16:9', size: '2048x1152' });
  assert.deepEqual(imageDraftGeometry('16:9'), { ratio: '16:9', size: undefined });
});

test('all image models accept eight references', () => {
  assert.deepEqual(IMG_MODELS.map((model) => model.maxReferences), [8, 8, 8, 8]);
});
