import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVideoTask,
  getVideoTask,
  isActiveVideoTask,
  listVideoTasks,
} from '../../lib/ai/video-client';

test('createVideoTask posts the complete request to the project video endpoint', async () => {
  let request: { input?: string | URL | Request; init?: RequestInit } = {};
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    request = { input, init };
    return new Response(JSON.stringify({ ok: true, task: { id: 'local-1', status: 'queued' } }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const task = await createVideoTask({
    projectId: 'project-1',
    shotId: 'shot-1',
    model: 'doubao-seedance-2-0-filter-off',
    prompt: 'slow dolly in',
    references: [{ type: 'image', url: 'https://example.com/frame.jpg', role: 'first_frame' }],
    duration: 6,
    ratio: '16:9',
    resolution: '1080p',
    watermark: false,
    generateAudio: true,
  }, fetcher);

  assert.equal(request.input, '/api/ai/video');
  assert.equal(request.init?.method, 'POST');
  assert.equal(JSON.parse(String(request.init?.body)).model, 'doubao-seedance-2-0-filter-off');
  assert.equal(task.id, 'local-1');
});

test('video client encodes ids and surfaces API errors', async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ error: 'provider unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(() => getVideoTask('task/1', fetcher), /provider unavailable/);
  assert.equal(calls[0], '/api/ai/video/task%2F1');
});

test('listVideoTasks reads project tasks and active status helper is precise', async () => {
  let url = '';
  const fetcher = async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify({ ok: true, tasks: [{ id: 'a', status: 'running' }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const tasks = await listVideoTasks('project / 1', fetcher);
  assert.equal(url, '/api/ai/video?projectId=project%20%2F%201');
  assert.equal(tasks[0].id, 'a');
  assert.equal(isActiveVideoTask({ status: 'queued' }), true);
  assert.equal(isActiveVideoTask({ status: 'running' }), true);
  assert.equal(isActiveVideoTask({ status: 'succeeded' }), false);
  assert.equal(isActiveVideoTask({ status: 'failed' }), false);
});
