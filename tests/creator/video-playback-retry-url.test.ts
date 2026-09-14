import assert from 'node:assert/strict';
import test from 'node:test';

import { creatorCanvasAssetContentUrl, creatorVideoContentUrl } from '../../lib/creator/video-client';

test('a playback recovery attempt receives a distinct same-origin URL', () => {
  const first = creatorVideoContentUrl('video task');
  const retry = creatorVideoContentUrl('video task', 'retry-1');

  assert.equal(first, '/api/creator/videos/video%20task/content');
  assert.equal(retry, '/api/creator/videos/video%20task/content?attempt=retry-1');
  assert.notEqual(retry, first);
});

test('a private canvas asset recovery attempt receives a distinct URL', () => {
  const first = creatorCanvasAssetContentUrl('user/uploads/source video.mp4');
  const retry = creatorCanvasAssetContentUrl('user/uploads/source video.mp4', 'retry-1');

  assert.equal(first, '/api/creator/canvas-assets/content?path=user%2Fuploads%2Fsource%20video.mp4');
  assert.equal(retry, '/api/creator/canvas-assets/content?path=user%2Fuploads%2Fsource%20video.mp4&attempt=retry-1');
  assert.notEqual(retry, first);
});
