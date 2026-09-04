import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import {
  VIDEO_MODELS,
  WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS,
  buildWetokenVideoRequest,
  buildSeedanceRequest,
  createWetokenVideoTask,
  getWetokenVideoTask,
} from '../../lib/ai/video';
import { validateVideoDraftInput, videoImageRoles } from '../../lib/creator/video';
import { CanvasNodeType, type CanvasNodeData } from '../../reference/infinite-canvas/src/types/canvas';
import { resetInterruptedGeneration } from '../../reference/infinite-canvas/src/lib/canvas/canvas-generation-helpers';
import { getVideoModel } from '../../lib/ai/video-models';

const originalKey = process.env.WETOKEN_API_KEY;
const originalBase = process.env.WETOKEN_BASE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.WETOKEN_API_KEY;
  else process.env.WETOKEN_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.WETOKEN_BASE_URL;
  else process.env.WETOKEN_BASE_URL = originalBase;
});

test('video catalog contains Seedance plus the four documented Wetoken video models', () => {
  assert.deepEqual(VIDEO_MODELS.map((model) => model.id), [
    'doubao-seedance-2-0',
    'doubao-seedance-2-0-filter-off',
    'doubao-seedance-2-0-fast',
    'doubao-seedance-2-0-fast-filter-off',
    'dreamina-seedance-2-0-mini',
    'dreamina-seedance-2-0-mini-filter-off',
    'dreamina-seedance-2-5',
    'dreamina-seedance-2-5-filter-off',
    'happyhorse-1.1-i2v',
    'happyhorse-1.1-r2v',
    'happyhorse-1.1-t2v',
    'MiniMax-H3',
  ]);
  assert.deepEqual(VIDEO_MODELS.map((model) => model.filterOff), [
    false, true, false, true, false, true, false, true,
    false, false, false, false,
  ]);
});

test('HappyHorse 1.1 image-to-video uses the DashScope first-frame contract', () => {
  assert.deepEqual(buildWetokenVideoRequest({
    model: 'happyhorse-1.1-i2v',
    prompt: 'the cat turns toward camera',
    references: [{ type: 'image', url: 'https://example.com/first.png', role: 'first_frame' }],
    duration: 5,
    ratio: 'adaptive',
    resolution: '720p',
    watermark: false,
    generateAudio: false,
  }), {
    family: 'dashscope',
    body: {
      model: 'happyhorse-1.1-i2v',
      input: {
        prompt: 'the cat turns toward camera',
        media: [{ type: 'first_frame', url: 'https://example.com/first.png' }],
      },
      parameters: {
        resolution: '720P',
        duration: 5,
        prompt_extend: true,
        watermark: false,
      },
    },
  });
});

test('HappyHorse 1.1 reference-to-video sends each reference image to DashScope', () => {
  assert.deepEqual(buildWetokenVideoRequest({
    model: 'happyhorse-1.1-r2v',
    prompt: 'combine the character and costume references',
    references: [
      { type: 'image', url: 'https://example.com/character.png', role: 'reference_image' },
      { type: 'image', url: 'https://example.com/costume.png', role: 'reference_image' },
    ],
    duration: 6,
    ratio: '9:16',
    resolution: '1080p',
    watermark: true,
    generateAudio: false,
  }), {
    family: 'dashscope',
    body: {
      model: 'happyhorse-1.1-r2v',
      input: {
        prompt: 'combine the character and costume references',
        media: [
          { type: 'reference_image', url: 'https://example.com/character.png' },
          { type: 'reference_image', url: 'https://example.com/costume.png' },
        ],
      },
      parameters: {
        resolution: '1080P',
        ratio: '9:16',
        duration: 6,
        prompt_extend: true,
        watermark: true,
      },
    },
  });
});

test('MiniMax H3 uses the V2 content request contract', () => {
  assert.deepEqual(buildWetokenVideoRequest({
    model: 'MiniMax-H3',
    prompt: 'cinematic train crossing a bridge at dawn',
    references: [{ type: 'image', url: 'https://example.com/first.png', role: 'first_frame' }],
    duration: 10,
    ratio: 'adaptive',
    resolution: '2K',
    watermark: false,
    generateAudio: true,
  }), {
    family: 'minimax-v2',
    body: {
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: 'cinematic train crossing a bridge at dawn' },
        { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'first_frame' },
      ],
      resolution: '2K',
      duration: 10,
      ratio: 'adaptive',
    },
  });
});

test('video model capability lists declare the ratios that the settings panel may offer', () => {
  const seedance = getVideoModel('doubao-seedance-2-0') as (ReturnType<typeof getVideoModel> & { ratios?: string[] });
  const seedance25 = getVideoModel('dreamina-seedance-2-5') as (ReturnType<typeof getVideoModel> & { ratios?: string[] });

  assert.deepEqual(seedance?.ratios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
  assert.deepEqual(seedance25?.ratios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
});

test('video submission keeps the provider connection alive for three hours by default', () => {
  assert.equal(WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS, 3 * 60 * 60 * 1000);
});

test('canvas result polling does not impose a second short timeout after submission', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'reference/infinite-canvas/src/services/api/video.ts'), 'utf8');

  assert.match(source, /for \(;;\) \{/);
  assert.doesNotMatch(source, /attempt < 60/);
  assert.match(source, /task\.status === "failed"/);
  assert.match(source, /task\.status === "expired"/);
  assert.match(source, /task\.status === "unknown" && !task\.external_task_id/);
});

test('canvas keeps an already-submitted creator video loading after a refresh', () => {
  const nodes: CanvasNodeData[] = [{
    id: 'video-1',
    type: CanvasNodeType.Video,
    title: 'Long Seedance render',
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { status: 'loading', creatorTaskId: 'creator-video-1' },
  }];

  const restored = resetInterruptedGeneration(nodes);
  assert.equal(restored[0].metadata?.status, 'loading');
  assert.equal(restored[0].metadata?.creatorTaskId, 'creator-video-1');
});

test('canvas records the local creator task ID before waiting for a long provider response', () => {
  const videoSource = fs.readFileSync(path.join(process.cwd(), 'reference/infinite-canvas/src/services/api/video.ts'), 'utf8');
  const canvasSource = fs.readFileSync(path.join(process.cwd(), 'reference/infinite-canvas/src/pages/canvas/project.tsx'), 'utf8');

  assert.match(videoSource, /onCreatorTaskCreated/);
  assert.match(canvasSource, /creatorTaskId/);
});

test('canvas confirmation schedules slow provider submission instead of holding the browser request open', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/videos/[id]/confirm/route.ts'), 'utf8');

  assert.match(route, /void completeProviderSubmission\(/);
  assert.match(route, /status: 202/);
});

test('video reference mode assigns ordinary and first/last-frame roles', () => {
  assert.deepEqual(videoImageRoles('reference', 3), ['reference_image', 'reference_image', 'reference_image']);
  assert.deepEqual(videoImageRoles('first_last', 2), ['first_frame', 'last_frame']);
  assert.throws(() => videoImageRoles('first_last', 3), /最多需要 2 张图片/);
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

test('Seedance request accepts Wetoken assets but rejects inline reference data', () => {
  const base = {
    model: 'dreamina-seedance-2-5', prompt: 'cinematic move', duration: 5, ratio: '16:9',
    resolution: '720p', watermark: false, generateAudio: true,
  };
  assert.doesNotThrow(() => buildSeedanceRequest({
    ...base,
    references: [{ type: 'image', url: 'asset://asset-ready', role: 'reference_image' }],
  }));
  assert.throws(() => buildSeedanceRequest({
    ...base,
    references: [{ type: 'image', url: 'data:image/png;base64,AA==', role: 'reference_image' }],
  }), /参考素材只支持公网 HTTPS URL 或 asset:\/\//);
});

test('creator video confirmation signs every reference before Wetoken asset upload', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/videos/[id]/confirm/route.ts'), 'utf8');

  assert.match(route, /createProviderSignedUrl\(paths\[index\], SIGNED_URL_TTL_SECONDS\)/);
  assert.match(route, /prepareWetokenAssetReferences\(claimed\.model, references(?:, \{ traceId, taskId: claimed\.id \})?\)/);
  assert.doesNotMatch(route, /readLocalFile\('creator-assets', paths\[index\]\)/);
});
test('Seedance validation rejects invalid combinations and model capabilities', () => {
  const base = {
    prompt: 'x', references: [], duration: 5, ratio: '16:9',
    resolution: '720p', watermark: false, generateAudio: true,
  };
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'other' }), /不支持的视频模型/);
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'doubao-seedance-2-0-fast', resolution: '1080p' }), /不支持 1080p/);
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'doubao-seedance-2-0', duration: 3 }), /时长/);
  assert.throws(() => buildSeedanceRequest({ ...base, model: 'dreamina-seedance-2-5', duration: 31 }), /时长/);
  assert.doesNotThrow(() => buildSeedanceRequest({ ...base, model: 'dreamina-seedance-2-5', duration: -1, ratio: 'adaptive' }));
  assert.doesNotThrow(() => buildSeedanceRequest({
    ...base,
    model: 'dreamina-seedance-2-5',
    references: [{ type: 'video', url: 'https://example.com/ref.mp4', role: 'reference_video' }],
  }));
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
  assert.throws(() => buildSeedanceRequest({
    ...base,
    model: 'dreamina-seedance-2-5',
    references: [{ type: 'image', url: 'https://example.com/first.jpg', role: 'first_frame' }],
  }), /只能使用 adaptive/);
});

test('Seedance 2.5 follows the documented multimodal request capabilities', () => {
  const request = buildSeedanceRequest({
    model: 'dreamina-seedance-2-5', prompt: '', references: [
      { type: 'audio', url: 'https://example.com/ref.mp3', role: 'reference_audio' },
    ], duration: -1,
    ratio: 'adaptive', resolution: '720p', watermark: false, generateAudio: true,
  });
  assert.equal(request.generate_audio, true);
  assert.equal(request.duration, -1);
  assert.deepEqual(request.content, [
    { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' },
  ]);
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

test('creator video drafts apply Seedance 2.5 frame and audio reference rules', () => {
  assert.doesNotThrow(() => validateVideoDraftInput({
    prompt: '',
    model: 'dreamina-seedance-2-5',
    references: [{ name: 'ref.mp3', mimeType: 'audio/mpeg', size: 100, kind: 'audio', role: 'reference_audio' }],
    duration: -1,
    ratio: 'adaptive',
    resolution: '720p',
    watermark: false,
    generateAudio: true,
  }));
  assert.throws(() => validateVideoDraftInput({
    prompt: 'x',
    model: 'dreamina-seedance-2-5',
    references: [{ name: 'first.jpg', mimeType: 'image/jpeg', size: 100, kind: 'image', role: 'first_frame' }],
    duration: 6,
    ratio: '16:9',
    resolution: '720p',
    watermark: false,
    generateAudio: true,
  }), /只能使用 adaptive/);
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

test('HappyHorse task submission uses DashScope async routing', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  let observed: { url: string; asyncHeader: string | null; body: unknown } | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    observed = {
      url: String(input),
      asyncHeader: new Headers(init?.headers).get('x-dashscope-async'),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ output: { task_id: 'horse-task' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await createWetokenVideoTask({
    model: 'happyhorse-1.1-t2v', prompt: 'a fox running through snow', references: [],
    duration: 3, ratio: '16:9', resolution: '720p', watermark: false, generateAudio: false,
  }, { fetcher });
  assert.equal(observed?.url, 'https://wetoken.example/dashscope/api/v1/services/aigc/video-generation/video-synthesis');
  assert.equal(observed?.asyncHeader, 'enable');
  assert.deepEqual(observed?.body, {
    model: 'happyhorse-1.1-t2v',
    input: { prompt: 'a fox running through snow' },
    parameters: { resolution: '720P', duration: 3, prompt_extend: true, watermark: false, ratio: '16:9' },
  });
  assert.equal(result.externalTaskId, 'horse-task');
});

test('MiniMax H3 task polling uses V2 routing and task content', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  let observedUrl = '';
  const fetcher = async (input: string | URL | Request) => {
    observedUrl = String(input);
    return new Response(JSON.stringify({
      task: { task_id: 'h3-task', status: 'Success', content: { url: 'https://cdn.example.com/h3.mp4' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await getWetokenVideoTask('h3-task', { model: 'MiniMax-H3', fetcher }), {
    externalTaskId: 'h3-task', status: 'succeeded', videoUrl: 'https://cdn.example.com/h3.mp4', error: undefined, usage: undefined,
  });
  assert.equal(observedUrl, 'https://wetoken.example/v2/query/video_generation/h3-task');
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
