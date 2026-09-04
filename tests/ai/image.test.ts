import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildGeminiImageBody,
  IMAGE_PROVIDER_TIMEOUT_MS,
  generateWetokenImage,
  sizeToAspectRatio,
  WetokenImageRequestError,
  WetokenImageResultError,
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
  // The image workspace also permits arbitrary dimensions. Gemini only
  // accepts named aspect ratios, so map those dimensions to the nearest one
  // instead of silently falling back to 1:1.
  assert.equal(sizeToAspectRatio('1824x1024'), '16:9');
  assert.equal(sizeToAspectRatio('1024x1824'), '9:16');
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

test('slow image providers get a five-minute route window while reserving time to persist the result', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  let requestedTimeoutMs: number | undefined;
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-lite-image', prompt: 'cinematic fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: 'YWJj', mimeType: 'image/jpeg' } }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    timeoutSignal: (timeoutMs: number) => {
      requestedTimeoutMs = timeoutMs;
      return new AbortController().signal;
    },
  });

  assert.deepEqual([...result.bytes], [97, 98, 99]);
  assert.equal(IMAGE_PROVIDER_TIMEOUT_MS, 270_000);
  assert.equal(requestedTimeoutMs, IMAGE_PROVIDER_TIMEOUT_MS);
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
    body: { model: 'gpt-image-2', prompt: 'fox', n: 1, size: '1024x1024' },
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
    ['image[]', 'reference-1.png'], ['image[]', 'reference-2.jpg'],
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

test('Gemini accepts a data URI and uses the real image header over a mismatched MIME label', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+qbaI1QAAAABJRU5ErkJggg==';
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: 'image/jpeg', data: `data:image/png;base64,${png}` } },
    ] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('Gemini accepts Wetoken OpenAI-compatible URL results without another provider call', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const urls: string[] = [];
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-lite-image', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async (input) => {
      urls.push(String(input));
      if (String(input).startsWith('https://cdn.example/')) {
        return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/generated.png' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.sourceUrl, 'https://cdn.example/generated.png');
  assert.equal(urls.length, 2);
});

test('Gemini request keeps the selected output tier and clamps models that only support 1K', () => {
  const pro = buildGeminiImageBody({
    model: 'gemini-3-pro-image-preview',
    prompt: 'cinematic fox',
    size: '2720x1536',
    references: [],
  });
  const lite = buildGeminiImageBody({
    model: 'gemini-3.1-flash-lite-image',
    prompt: 'cinematic fox',
    size: '2720x1536',
    references: [],
  });

  assert.equal(pro.generationConfig.imageConfig.imageSize, '2K');
  assert.equal(lite.generationConfig.imageConfig.imageSize, '1K');
});

test('Gemini accepts nested gateway envelopes and SSE result events', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response([
      'data: {"response":{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/jpeg","data":"YWJj"}}]}}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  });

  assert.deepEqual([...result.bytes], [97, 98, 99]);
  assert.equal(result.mimeType, 'image/jpeg');
});

test('Gemini accepts an image data URI embedded in a gateway text part', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+qbaI1QAAAABJRU5ErkJggg==';
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(JSON.stringify({
      response: { output: { content: [{ type: 'text', text: `![generated](data:image/png;base64,${png})` }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('Gemini unwraps a JSON-serialised gateway response before reading inline image data', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(JSON.stringify({
      response: JSON.stringify({
        candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'YWJj' } }] } }],
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  assert.deepEqual([...result.bytes], [97, 98, 99]);
  assert.equal(result.mimeType, 'image/jpeg');
});

test('Gemini accepts gateway image_url strings without requiring a manual download', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+qbaI1QAAAABJRU5ErkJggg==';
  const result = await generateWetokenImage({
    model: 'gemini-3.1-flash-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(JSON.stringify({
      response: { output: { content: [{ type: 'image_url', image_url: `data:image/png;base64,${png}` }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('Gemini missing results expose only diagnostic shape and never provider content', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  await assert.rejects(
    () => generateWetokenImage({
      model: 'gemini-3-pro-image-preview', prompt: 'fox', size: '1024x1024', references: [],
    }, {
      fetcher: async () => new Response(JSON.stringify({
        output: { trace: 'must-not-be-persisted', candidates: [{ content: { parts: [{ text: 'not an image' }] } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-test' } }),
    }),
    (error: unknown) => error instanceof WetokenImageResultError
      && error.diagnostic?.status === 200
      && error.diagnostic.requestId === 'req-test'
      && error.diagnostic.payloadShape.includes('output')
      && !JSON.stringify(error.diagnostic).includes('must-not-be-persisted'),
  );
});

test('Gemini accepts direct image responses from the gateway', async () => {
  process.env.WETOKEN_API_KEY = 'test-key';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const result = await generateWetokenImage({
    model: 'gemini-3-pro-image-preview', prompt: 'fox', size: '1024x1024', references: [],
  }, {
    fetcher: async () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes], [...png]);
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
