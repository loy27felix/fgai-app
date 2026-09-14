import assert from 'node:assert/strict';
import test from 'node:test';

import { nextVideoPlaybackRecoveryAttempt } from '../reference/infinite-canvas/src/lib/canvas/canvas-video-playback-retry';

test('video playback only auto-recovers twice before asking the user to reconnect it', () => {
  assert.equal(nextVideoPlaybackRecoveryAttempt(undefined), 1);
  assert.equal(nextVideoPlaybackRecoveryAttempt(1), 2);
  assert.equal(nextVideoPlaybackRecoveryAttempt(2), null);
});

test('a user-requested reconnect is allowed after automatic recovery is exhausted', () => {
  assert.equal(nextVideoPlaybackRecoveryAttempt(2, { manual: true }), 3);
});
