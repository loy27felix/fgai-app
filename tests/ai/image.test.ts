import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildGeminiImageBody,
  generateWetokenImage,
  sizeToAspectRatio,
  WetokenImageRequestError,
} from '../../lib/ai/image';

const originalKey = process.env.WETOKEN_API_KEY;
const originalBase = process.env.WETOKEN_BASE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.WETOKEN_API_KEY;
  else process.env.WETOKEN_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.WETOKEN_BASE_URL;
  else process.env.WETOKEN_BASE_URL = originalBase;
});

test('Gemini request maps prompt, references and aspect ratio', () => {
  assert.equal(sizeToAspectRatio('1536x864'), '16:9');
  assert.deepEqual(buildGeminiImageBody({
    prompt: 'cinematic fox',
    size: '768x1344',
    references: [{ data: 'YWJj', mimeType: 'image/jpeg' }],
  }), {
    contents: [{ role: 'user', parts: [
      { text: 'cinematic fox' },
      { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } },
    ] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '9:16', imageSize: '1K', outputMIMEType: 'image/jpeg' },
    },
  });
});

test('GPT image generation sends JSON and normalizes base64 output', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1/';
  let observed: { url: string; body: unknown; authorization: string | null } | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    observed = {
      url: String(input),
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get('authorization'),
    };
    return new Response(JSON.stringify({ data: [{ b64_json: 'YWJj' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await generateWetokenImage({
    model: 'gpt-image-2', prompt: 'fox', size: '1024x1024', references: [],
  }, { fetcher });

  assert.deepEqual(observed, {
    url: 'https://wetoken.example/v1/images/generations',
    authorization: 'Bearer test-key',
    body: { model: 'gpt-image-2', prompt: 'fox', n: 1, size: '1024x1024', response_format: 'b64_json' },
  });
  assert.deepEqual([...result.bytes], [97, 98, 99]);
  assert.equal(result.mimeType, 'image/png');
});

test('GPT image edit sends repeated image fields for multiple references', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  let entries: Array<[string, string]> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    entries = Array.from(form.entries()).map(([key, value]) => [key, typeof value === 'string' ? value : value.name]);
    return new Response(JSON.stringify({ data: [{ b64_json: 'YWJj' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await generateWetokenImage({
    model: 'gpt-image-2', prompt: 'combine', size: '1024x1024', references: [
      { data: 'YWJj', mimeType: 'image/png' },
      { data: 'ZGVm', mimeType: 'image/jpeg' },
    ],
  }, { fetcher });

  assert.deepEqual(entries, [
    ['model', 'gpt-image-2'], ['prompt', 'combine'], ['size', '1024x1024'], ['n', '1'],
    ['response_format', 'b64_json'], ['image[]', 'reference-1.png'], ['image[]', 'reference-2.jpg'],
  ]);
});

test('Gemini generation calls generateContent and parses inlineData', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1';
  let url = '';
  const fetcher = async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { text: 'done' },
      { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } },
    ] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await generateWetokenImage({
    model: 'gemini-3-pro-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, { fetcher });

  assert.equal(url, 'https://wetoken.example/v1/content/models/gemini-3-pro-image-preview:generateContent');
  assert.deepEqual([...result.bytes], [97, 98, 99]);
  assert.equal(result.mimeType, 'image/jpeg');
});

test('Gemini provider errors retain a bounded client-safe reason', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const fetcher = async () => new Response(JSON.stringify({
    error: { message: 'imageConfig.outputMIMEType is required; Bearer sk-secret-value' },
  }), { status: 400, statusText: 'Bad Request' });

  await assert.rejects(
    () => generateWetokenImage({
      model: 'gemini-3-pro-image-preview', prompt: 'fox', size: '1024x1024', references: [],
    }, { fetcher }),
    (error: unknown) => error instanceof WetokenImageRequestError
      && error.status === 400
      && error.publicMessage.includes('outputMIMEType')
      && !error.publicMessage.includes('sk-secret-value'),
  );
});

test('image client rejects unknown models and missing key before fetching', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  await assert.rejects(
    () => generateWetokenImage({ model: 'other', prompt: 'x', size: '1x1', references: [] }),
    /不支持的图片模型/,
  );
  delete process.env.WETOKEN_API_KEY;
  await assert.rejects(
    () => generateWetokenImage({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024', references: [] }),
    /缺少 WETOKEN_API_KEY/,
  );
});

test('shared image generator accepts eight references and rejects the ninth', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const reference = { data: 'YWJj', mimeType: 'image/png' };
  const fetcher = async () => new Response(JSON.stringify({ data: [{ b64_json: 'YWJj' }] }), { status: 200 });
  await generateWetokenImage({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024', references: Array(8).fill(reference) }, { fetcher });
  await assert.rejects(() => generateWetokenImage({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024', references: Array(9).fill(reference) }, { fetcher }), /最多 8 张/);
});
