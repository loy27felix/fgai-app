import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('video generation has a durable same-origin playback fallback', () => {
  const video = read('reference/infinite-canvas/src/services/api/video.ts');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const contentRoute = read('app/api/creator/videos/[id]/content/route.ts');
  const taskRoute = read('app/api/creator/videos/[id]/route.ts');

  assert.match(video, /fallbackUrl\?: string/);
  assert.match(video, /result\.fallbackUrl/);
  // The playback proxy is now created in one helper so every completed task
  // gets the same same-origin URL, whether it finishes immediately or after
  // polling.
  assert.match(video, /creatorVideoContentUrl\(taskId\)/);
  assert.match(contentRoute, /Accept-Ranges/);
  assert.match(contentRoute, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(contentRoute, /video_storage_path/);
  assert.match(contentRoute, /createAdminClient/);
  assert.match(video, /creatorTaskId\?: string/);
  assert.match(video, /durableArchivePending\?: boolean/);
  assert.match(video, /persistGeneratedCanvasAsset\(source/);
  assert.doesNotMatch(video, /uploadMediaFile\(input, "video"\)/);
  assert.match(project, /status: NODE_STATUS_ERROR/);
  assert.match(project, /logClientEvent\("canvas_video_playback_error"/);
  assert.match(project, /logClientEvent\("canvas_video_playback_recovered"/);
  assert.match(taskRoute, /await ensureVideoOutputStored\(context, providerUpdatedTask\)/);
  assert.doesNotMatch(taskRoute, /void ensureVideoOutputStored\(context, providerUpdatedTask\)/);
});
