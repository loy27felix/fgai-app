import assert from 'node:assert/strict';
import test from 'node:test';

import { KnownVideoTaskRecoveryError, reconcileKnownWetokenVideoTask } from '../../lib/creator/video-recovery';

test('reconciles a locally-unknown video task with a known succeeded Wetoken task and archives its URL', async () => {
  const persistedOutputs: Record<string, unknown>[] = [];
  const saved = await reconcileKnownWetokenVideoTask({
    task: {
      id: 'd8f94f94-b19e-4185-8df7-4f4ca2a773d1',
      output: { previous: 'kept' },
    },
    externalTaskId: 'cgt-20260824150224-jjbsw',
    loadProviderTask: async () => ({
      externalTaskId: 'cgt-20260824150224-jjbsw',
      status: 'succeeded',
      videoUrl: 'https://media.example/result.mp4',
      usage: { total_cost: 0.91 },
    }),
    persistOutput: async (output) => {
      persistedOutputs.push(output);
      return { ...output, video_storage_path: 'user/video-tasks/d8f94f94-b19e-4185-8df7-4f4ca2a773d1/result.mp4' };
    },
    saveTask: async (update) => update,
    now: () => '2026-08-24T15:20:00.000Z',
  });

  assert.deepEqual(persistedOutputs, [{
    previous: 'kept',
    provider_task_id: 'cgt-20260824150224-jjbsw',
    video_url: 'https://media.example/result.mp4',
  }]);
  assert.equal(saved.task.externalTaskId, 'cgt-20260824150224-jjbsw');
  assert.equal(saved.task.status, 'succeeded');
  assert.equal(saved.task.completedAt, '2026-08-24T15:20:00.000Z');
  assert.equal(saved.task.output.video_storage_path, 'user/video-tasks/d8f94f94-b19e-4185-8df7-4f4ca2a773d1/result.mp4');
});

test('does not claim recovery when Wetoken has no playable video URL', async () => {
  await assert.rejects(
    () => reconcileKnownWetokenVideoTask({
      task: { id: 'd8f94f94-b19e-4185-8df7-4f4ca2a773d1', output: {} },
      externalTaskId: 'cgt-20260824150224-jjbsw',
      loadProviderTask: async () => ({ externalTaskId: 'cgt-20260824150224-jjbsw', status: 'succeeded', videoUrl: undefined }),
      persistOutput: async (output) => output,
      saveTask: async (update) => update,
    }),
    (error: unknown) => error instanceof KnownVideoTaskRecoveryError && error.code === 'PROVIDER_VIDEO_URL_MISSING',
  );
});
