import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSeedanceRatio, seedanceRatioOptions } from '../reference/infinite-canvas/src/lib/seedance-video';

test('video ratio presets use standard aspect-ratio labels instead of pixel dimensions', () => {
  assert.deepEqual(
    seedanceRatioOptions.slice(0, 6).map((item) => item.label),
    ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  );
  assert.equal(normalizeSeedanceRatio('1280x720'), '16:9');
  assert.equal(normalizeSeedanceRatio('720x1280'), '9:16');
});
