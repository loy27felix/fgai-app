import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { wetokenChat } from '../../lib/ai/wetoken-client';

const originalKey = process.env.WETOKEN_API_KEY;
const originalBase = process.env.WETOKEN_BASE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.WETOKEN_API_KEY;
  else process.env.WETOKEN_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.WETOKEN_BASE_URL;
  else process.env.WETOKEN_BASE_URL = originalBase;
});

test('Wetoken client sends an OpenAI-compatible request and normalizes the result', async () => {
  process.env.WETOKEN_API_KEY = 'test-wetoken-key';
  process.env.WETOKEN_BASE_URL = 'https://wetoken.example/v1/';
  let observed: { url: string; authorization: string | null; body: unknown } | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    observed = {
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'world' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await wetokenChat({
    model: 'gpt-5.6-luna-t1a',
    messages: [{ role: 'user', content: 'hello' }],
    jsonOutput: true,
    maxTokens: 321,
  }, { fetcher });

  assert.deepEqual(observed, {
    url: 'https://wetoken.example/v1/chat/completions',
    authorization: 'Bearer test-wetoken-key',
    body: {
      model: 'gpt-5.6-luna-t1a',
      messages: [{ role: 'user', content: 'hello\n\n仅返回一个有效的 json object，不要 Markdown。' }],
      stream: false,
      max_tokens: 321,
      response_format: { type: 'json_object' },
    },
  });
  assert.deepEqual(result, {
    content: 'world',
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  });
});

test('Wetoken JSON mode always gives the provider a lowercase json instruction', async () => {
  process.env.WETOKEN_API_KEY = 'test-wetoken-key';
  let requestBody: { messages?: Array<{ content?: unknown }> } | undefined;
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await wetokenChat({
    model: 'gpt-5.6-luna-t1a',
    messages: [{ role: 'user', content: '帮我规划一个视频' }],
    jsonOutput: true,
  }, { fetcher });

  assert.equal(requestBody?.messages?.some((message) => typeof message.content === 'string' && /\bjson\b/.test(message.content)), true);
});

test('Wetoken JSON mode adds the json instruction to the final user message', async () => {
  process.env.WETOKEN_API_KEY = 'test-wetoken-key';
  let requestBody: { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await wetokenChat({
    model: 'gpt-5.6-luna-t1a',
    messages: [{ role: 'system', content: '请规划视频。' }, { role: 'user', content: '我想做一个玩具宣传片。' }],
    jsonOutput: true,
  }, { fetcher });

  const finalUser = requestBody?.messages?.filter((message) => message.role === 'user').at(-1);
  assert.equal(typeof finalUser?.content, 'string');
  assert.match(String(finalUser?.content), /\bjson\b/);
});

test('Wetoken client rejects a missing server key before fetching', async () => {
  delete process.env.WETOKEN_API_KEY;
  await assert.rejects(
    () => wetokenChat({ model: 'gpt-5.6-luna-t1a', messages: [] }),
    /缺少 WETOKEN_API_KEY/,
  );
});

test('Wetoken client exposes a bounded provider error without leaking the key', async () => {
  process.env.WETOKEN_API_KEY = 'test-wetoken-key';
  const fetcher = async () => new Response(
    JSON.stringify({ error: { message: 'rate limited' } }),
    { status: 429, statusText: 'Too Many Requests', headers: { 'Content-Type': 'application/json' } },
  );

  await assert.rejects(
    () => wetokenChat({ model: 'gpt-5.6-luna-t1a', messages: [] }, { fetcher }),
    (error: unknown) => {
      assert.match(String(error), /Wetoken 429: rate limited/);
      assert.doesNotMatch(String(error), /test-wetoken-key/);
      return true;
    },
  );
});
