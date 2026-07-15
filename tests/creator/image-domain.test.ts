import assert from 'node:assert/strict';
import test from 'node:test';
import { composeImageGenerationPrompt, validateImageDraftInput } from '../../lib/creator/image';

const file = (index: number) => ({ name: `ref-${index}.png`, mimeType: 'image/png', size: 1024 });

test('accepts eight references and rejects the ninth', () => {
  assert.equal(validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 8 }, (_, i) => file(i)),
  }).references.length, 8);
  assert.throws(() => validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 9 }, (_, i) => file(i)),
  }), /最多 8 张参考图/);
});

test('rejects unsupported types and oversized totals', () => {
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [{ name: 'x.gif', mimeType: 'image/gif', size: 10 }],
  }), /JPEG、PNG 或 WebP/);
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: Array.from({ length: 5 }, (_, i) => ({ ...file(i), size: 7_000_000 })),
  }), /总大小不能超过 28MB/);
});

test('skill instructions are snapshotted into the effective image prompt', () => {
  const result = composeImageGenerationPrompt('a fox in snow', { name: '电影感', content: 'Use anamorphic composition and cold rim light.' });
  assert.match(result, /电影感/);
  assert.match(result, /anamorphic composition/);
  assert.match(result, /a fox in snow/);
});
