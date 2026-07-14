import assert from 'node:assert/strict';
import test from 'node:test';
import { chatWithTextModel } from '../../lib/ai/text';

const messages = [
  { role: 'system' as const, content: 'system' },
  { role: 'user' as const, content: 'hello' },
];

test('Wetoken selection calls only the exact selected Wetoken model', async () => {
  let wetokenModel = '';
  let deepseekCalls = 0;
  const { spec, result } = await chatWithTextModel(
    { modelId: 'gpt-5.6-terra', messages },
    {
      wetoken: async (options) => {
        wetokenModel = options.model;
        return { content: 'terra' };
      },
      deepseek: async () => {
        deepseekCalls += 1;
        return { content: 'unexpected' };
      },
    },
  );

  assert.equal(spec.id, 'gpt-5.6-terra');
  assert.equal(result.content, 'terra');
  assert.equal(wetokenModel, 'gpt-5.6-terra');
  assert.equal(deepseekCalls, 0);
});

test('DeepSeek Pro selection forwards mode and thinking only to DeepSeek', async () => {
  let received: unknown;
  let wetokenCalls = 0;
  await chatWithTextModel(
    { modelId: 'deepseek-pro', messages, thinking: true, jsonOutput: true },
    {
      deepseek: async (options) => {
        received = options;
        return { content: 'pro' };
      },
      wetoken: async () => {
        wetokenCalls += 1;
        return { content: 'unexpected' };
      },
    },
  );

  assert.deepEqual(received, {
    messages,
    mode: 'pro',
    thinking: true,
    jsonOutput: true,
    maxTokens: undefined,
  });
  assert.equal(wetokenCalls, 0);
});

test('Wetoken multimodal input attaches images to only the final user message', async () => {
  let receivedMessages: unknown;
  await chatWithTextModel(
    {
      modelId: 'claude-opus-4-8',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'ready' },
        { role: 'user', content: 'describe' },
      ],
      images: ['data:image/png;base64,one', 'data:image/png;base64,two'],
    },
    {
      wetoken: async (options) => {
        receivedMessages = options.messages;
        return { content: 'vision' };
      },
    },
  );

  assert.deepEqual(receivedMessages, [
    { role: 'system', content: 'system' },
    { role: 'assistant', content: 'ready' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,one' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,two' } },
      ],
    },
  ]);
});

test('DeepSeek with images rejects instead of silently substituting a model', async () => {
  let calls = 0;
  await assert.rejects(
    () => chatWithTextModel(
      { modelId: 'deepseek-flash', messages, images: ['data:image/png;base64,one'] },
      {
        deepseek: async () => { calls += 1; return { content: '' }; },
        wetoken: async () => { calls += 1; return { content: '' }; },
      },
    ),
    /DeepSeek 当前不支持图片输入，请选择 GPT-5.6 或 Claude Opus 4.8/,
  );
  assert.equal(calls, 0);
});
