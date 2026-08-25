import assert from 'node:assert/strict';
import test from 'node:test';
import { chatWithTextModel } from '../../lib/ai/text';

const messages = [
  { role: 'system' as const, content: 'system' },
  { role: 'user' as const, content: 'hello' },
];

test('Wetoken selection calls the exact selected T1A model', async () => {
  let wetokenModel = '';
  const { spec, result } = await chatWithTextModel(
    { modelId: 'gpt-5.6-terra-t1a', messages },
    {
      wetoken: async (options) => {
        wetokenModel = options.model;
        return { content: 'terra' };
      },
    },
  );

  assert.equal(spec.id, 'gpt-5.6-terra-t1a');
  assert.equal(result.content, 'terra');
  assert.equal(wetokenModel, 'gpt-5.6-terra-t1a');
});

test('DeepSeek V4 Pro selection is also routed through Wetoken', async () => {
  let received: unknown;
  await chatWithTextModel(
    { modelId: 'deepseek-v4-pro', messages, thinking: true, jsonOutput: true },
    {
      wetoken: async (options) => {
        received = options;
        return { content: 'pro' };
      },
    },
  );

  assert.deepEqual(received, {
    model: 'deepseek-v4-pro',
    messages,
    jsonOutput: true,
    maxTokens: undefined,
  });
});

test('Wetoken multimodal input attaches images to only the final user message', async () => {
  let receivedMessages: unknown;
  await chatWithTextModel(
    {
      modelId: 'claude-opus-5',
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

test('DeepSeek V4 Pro with images rejects instead of silently substituting a model', async () => {
  let calls = 0;
  await assert.rejects(
    () => chatWithTextModel(
      { modelId: 'deepseek-v4-pro', messages, images: ['data:image/png;base64,one'] },
      {
        wetoken: async () => { calls += 1; return { content: '' }; },
      },
    ),
    /当前模型不支持图片输入/,
  );
  assert.equal(calls, 0);
});
