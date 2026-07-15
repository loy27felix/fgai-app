import assert from 'node:assert/strict';
import test from 'node:test';
import { messageText, titleFromPrompt, toTextModelMessages } from '@/lib/creator/chat';

test('creator messages map to bounded text-model history', () => {
  const rows = [
    { role: 'tool', content: { text: 'hidden' }, status: 'complete' },
    { role: 'user', content: { text: '第一条' }, status: 'complete' },
    { role: 'assistant', content: { text: '第二条' }, status: 'complete' },
    { role: 'assistant', content: { text: 'failed' }, status: 'failed' },
  ];

  assert.deepEqual(toTextModelMessages(rows), [
    { role: 'user', content: '第一条' },
    { role: 'assistant', content: '第二条' },
  ]);
});

test('creator message content is normalized without leaking objects', () => {
  assert.equal(messageText({ text: '你好' }), '你好');
  assert.equal(messageText('纯文本'), '纯文本');
  assert.equal(messageText({ prompt: 'not a chat message' }), '');
});

test('new chat title is concise and stable', () => {
  assert.equal(titleFromPrompt('  帮我设计一个充满雾气的未来港口。  '), '帮我设计一个充满雾气的未来港口。');
  assert.equal(titleFromPrompt('a'.repeat(80)).length, 28);
});
