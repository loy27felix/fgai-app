import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPlayableVideoUrl } from '../../lib/creator/video-recovery';

test('video recovery rejects an expired or quota error response', async () => {
  await assert.rejects(
    () => assertPlayableVideoUrl('https://provider.example/video.mp4', {
      fetcher: async () => new Response('{"error":"expired"}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /HTTP 403/,
  );
});

test('video recovery rejects a successful JSON envelope', async () => {
  await assert.rejects(
    () => assertPlayableVideoUrl('/api/creator/videos/cgt-test/content', {
      fetcher: async () => new Response('{"error":"VIDEO_CONTENT_UNAVAILABLE"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /playable video file/,
  );
});

test('video recovery accepts a ranged MP4 response', async () => {
  const result = await assertPlayableVideoUrl('/api/creator/videos/cgt-test/content', {
    fetcher: async () => new Response(new Uint8Array([0, 1]), {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-length': '2' },
    }),
  });

  assert.equal(result.status, 206);
  assert.equal(result.contentType, 'video/mp4');
});
