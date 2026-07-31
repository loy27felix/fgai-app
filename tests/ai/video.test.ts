import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  VIDEO_MODELS,
  buildSeedanceRequest,
  createWetokenVideoTask,
  getWetokenVideoTask,
} from '../../lib/ai/video';
import { validateVideoDraftInput } from '../../lib/creator/video';

const originalKey = process.env.WETOKEN_API_KEY;
const originalBase = process.env.WETOKEN_BASE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.WETOKEN_API_KEY;
  else process.env.WETOKEN_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.WETOKEN_BASE_URL;
  else process.env.WETOKEN_BASE_URL = originalBase;
});

test('video catalog contains all normal and filter-off Seedance models', () => {
  assert.deepEqual(VIDEO_MODELS.map((model) => model.id), [
    'doubao-seedance-2-0',
    'doubao-seedance-2-0-filter-off',
    'doubao-seedance-2-0-fast',
    'doubao-seedance-2-0-fast-filter-off',
    'dreamina-seedance-2-0-mini',
    'dreamina-seedance-2-0-mini-filter-off',
  ]);
  assert.deepEqual(VIDEO_MODELS.map((model) => model.filterOff), [
    false, true, false, true, false, true,
  ]);
});

test('Seedance request maps text and reference media roles', () => {
  assert.deepEqual(buildSeedanceRequest({
    model: 'doubao-seedance-2-0',
    prompt: 'cinematic move',
    references: [
      { type: 'image', url: 'https://example.com/ref.jpg', role: 'reference_image' },
      { type: 'video', url: 'https://example.com/ref.mp4', role: 'reference_video' },
      { type: 'audio', url: 'https://example.com/ref.mp3', role: 'reference_audio' },
    ],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generateAudio: true,
  }), {
    model: 'doubao-seedance-2-0',
    content: [
      { type: 'text', text: 'cinematic move' },
      { type: 'image_url', image_url: { url: 'https://example.com/ref.jpg' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' },
    ],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generate_audio: true,
  });
});

test('Seedance request maps first and last frame roles', () => {
  const request = buildSeedanceRequest({
    model: 'doubao-seedance-2-0',
    prompt: 'cinematic move',
    references: [
      { type: 'image', url: 'https://example.com/first.jpg', role: 'first_frame' },
      { type: 'image', url: 'https://example.com/last.jpg', role: 'last_frame' },
    ],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generateAudio: true,
  });
  assert.deepEqual(request.content.slice(1), [
    { type: 'image_url', image_url: { url: 'https://example.com/first.jpg' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'https://example.com/last.jpg' }, role: 'last_frame' },
  ]);
});
test('Seedance validation rejects invalid combinations and model capabilities', () => {
  const base = {
    prompt: 'x', references: [], duration: 5, ratio: '16:9',
    resolution: '720p', watermark: false, generateAudio: true,
  };
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'other' }), /不支持的视频模型/);
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'doubao-seedance-2-0-fast', resolution: '1080p' }), /不支持 1080p/);
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'doubao-seedance-2-0', duration: 3 }), /时长/);
  assert.throws(() => buildSeedanceRequest({
    ...base,
    model: 'doubao-seedance-2-0',
    prompt: '',
    references: [{ type: 'audio', url: 'https://example.com/a.mp3', role: 'reference_audio' }],
  }), /音频不能单独作为参考/);
  assert.throws(() => buildSeedanceRequest({
    ...base,
    model: 'doubao-seedance-2-0',
    references: [
      { type: 'image', url: 'https://example.com/first.jpg', role: 'first_frame' },
      { type: 'image', url: 'https://example.com/ref.jpg', role: 'reference_image' },
    ],
  }), /首帧\/尾帧不能与参考图/);
});


test('creator video drafts reject mixed frame and reference media roles', () => {
  assert.throws(() => validateVideoDraftInput({
    prompt: 'x',
    model: 'doubao-seedance-2-0',
    references: [
      { name: 'first.jpg', mimeType: 'image/jpeg', size: 100, kind: 'image', role: 'first_frame' },
      { name: 'ref.jpg', mimeType: 'image/jpeg', size: 100, kind: 'image', role: 'reference_image' },
    ],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generateAudio: false,
  }), /首帧\/尾帧不能与参考图/);
});

test('video client creates a task on the native Wetoken endpoint', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  let observed: { url: string; authorization: string | null; body: any } | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    observed = {
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ id: 'task-123', status: 'queued' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await createWetokenVideoTask({
    model: 'dreamina-seedance-2-0-mini-filter-off',
    prompt: 'fox',
    references: [],
    duration: 5,
    ratio: '9:16',
    resolution: '720p',
    watermark: false,
    generateAudio: true,
  }, { fetcher });
  assert.equal(observed?.url, 'https://wetoken.example/api/v3/contents/generations/tasks');
  assert.equal(observed?.authorization, 'Bearer test-key');
  assert.equal(observed?.body.model, 'dreamina-seedance-2-0-mini-filter-off');
  assert.deepEqual(result, { externalTaskId: 'task-123', status: 'queued', raw: { id: 'task-123', status: 'queued' } });
});


test('video client unwraps a gateway task envelope and pending status', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  const fetcher = async () => new Response(JSON.stringify({
    code: 'ok',
    data: { id: 'task-enveloped', status: 'pending' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  assert.deepEqual(await createWetokenVideoTask({
    model: 'doubao-seedance-2-0',
    prompt: 'fox',
    references: [],
    duration: 6,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generateAudio: false,
  }, { fetcher }), {
    externalTaskId: 'task-enveloped',
    status: 'running',
    raw: { code: 'ok', data: { id: 'task-enveloped', status: 'pending' } },
  });
});

test('video client unwraps a gateway status and content envelope', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  const fetcher = async () => new Response(JSON.stringify({
    code: 'ok',
    data: { status: 'completed', content: { url: 'https://cdn.example.com/enveloped.mp4' } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  assert.deepEqual(await getWetokenVideoTask('task-enveloped', { fetcher }), {
    externalTaskId: 'task-enveloped',
    status: 'succeeded',
    videoUrl: 'https://cdn.example.com/enveloped.mp4',
    error: undefined,
    usage: undefined,
  });
});
test('video client surfaces the useful message from a Wetoken gateway error envelope', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  const fetcher = async () => new Response(JSON.stringify({
    code: 'upstream_error',
    message: JSON.stringify({
      error: { code: 'InvalidParameter', message: 'the ratio is not valid', param: 'ratio' },
    }),
    data: null,
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    () => createWetokenVideoTask({
      model: 'doubao-seedance-2-0',
      prompt: 'fox',
      references: [],
      duration: 6,
      ratio: '16:9',
      resolution: '720p',
      watermark: false,
      generateAudio: false,
    }, { fetcher }),
    (error: unknown) => {
      assert.match(String(error), /the ratio is not valid/);
      assert.doesNotMatch(String(error), /"param":"ratio"/);
      return true;
    },
  );
});
test('video client normalizes a succeeded query result', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  const fetcher = async () => new Response(JSON.stringify({
    id: 'task-123',
    status: 'succeeded',
    content: { video_url: 'https://cdn.example.com/result.mp4' },
    usage: { total_tokens: 42 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await getWetokenVideoTask('task-123', { fetcher }), {
    externalTaskId: 'task-123',
    status: 'succeeded',
    videoUrl: 'https://cdn.example.com/result.mp4',
    error: undefined,
    usage: { total_tokens: 42 },
  });
});
