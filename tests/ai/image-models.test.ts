import assert from 'node:assert/strict';
import test from 'node:test';
import * as imageModels from '../../lib/imageModels';
import { imageDraftGeometry, IMG_MODELS, ratioForImageSize, sizeFor, supportsExactImageSize } from '../../lib/imageModels';

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

test('only GPT Image 2 exposes exact 2K and 4K image-size controls', () => {
  assert.equal(supportsExactImageSize('gpt-image-2'), true);
  assert.equal(supportsExactImageSize('gemini-3-pro-image-preview'), false);
  assert.equal(supportsExactImageSize('gemini-3.1-flash-image-preview'), false);
});

test('image model capability lists expose only the resolution tiers each provider accepts', () => {
  const outputSizeOptionsFor = (imageModels as typeof imageModels & {
    imageOutputSizeOptionsFor?: (model: string) => string[];
  }).imageOutputSizeOptionsFor;

  assert.equal(typeof outputSizeOptionsFor, 'function');
  assert.deepEqual(outputSizeOptionsFor?.('gpt-image-2'), ['1K', '2K', '4K']);
  assert.deepEqual(outputSizeOptionsFor?.('gemini-3-pro-image-preview'), ['1K', '2K', '4K']);
  assert.deepEqual(outputSizeOptionsFor?.('gemini-3.1-flash-lite-image'), ['1K']);
});

test('image quality and ratio become a bounded draft size before the Creator request', () => {
  const requestSizeForModel = (imageModels as typeof imageModels & {
    imageRequestSizeForModel?: (model: string, ratioOrSize: string, quality?: string) => string | undefined;
  }).imageRequestSizeForModel;

  assert.equal(typeof requestSizeForModel, 'function');
  assert.equal(requestSizeForModel?.('gemini-3-pro-image-preview', '16:9', 'medium'), '2720x1536');
  assert.equal(requestSizeForModel?.('gemini-3-pro-image-preview', '16:9', 'high'), '3840x2160');
  assert.equal(requestSizeForModel?.('gemini-3.1-flash-lite-image', '16:9', 'high'), '1360x768');
  assert.equal(requestSizeForModel?.('gemini-3-pro-image-preview', 'auto', 'medium'), '2048x2048');
  assert.equal(requestSizeForModel?.('gpt-image-2', '16:9', 'auto'), undefined);
});
