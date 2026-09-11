import assert from 'node:assert/strict';
import test from 'node:test';
import { describeWetokenAssetError, WetokenAssetError } from '../../lib/ai/wetoken-assets';

test('turns Wetoken reference dimensions into an actionable Chinese error', () => {
  const detail = describeWetokenAssetError(new WetokenAssetError('Width must be between 300px and 6000px.', 400));
  assert.equal(detail.code, 'REFERENCE_DIMENSION_INVALID');
  assert.match(detail.message, /宽和高/);
  assert.match(detail.message, /300–6000px/);
});

test('turns Wetoken reference duration into an actionable Chinese error', () => {
  const detail = describeWetokenAssetError(new WetokenAssetError('Duration must be between 1.8s and 30.2s.', 400));
  assert.equal(detail.code, 'REFERENCE_DURATION_INVALID');
  assert.match(detail.message, /1.8–30.2 秒/);
});

test('keeps an unknown asset rejection actionable without leaking credentials', () => {
  const detail = describeWetokenAssetError(new WetokenAssetError('Provider validation refused the source; Bearer sk-secret-token', 400));
  assert.equal(detail.code, 'REFERENCE_PROVIDER_REJECTED');
  assert.match(detail.message, /参考素材未通过 Wetoken 校验/);
  assert.doesNotMatch(detail.message, /sk-secret-token/);
});
