import assert from 'node:assert/strict';
import test from 'node:test';
import { referencePathFor, validateImageDraftInput } from '../../lib/creator/image';

const file = (index: number) => ({ name: `ref-${index}.png`, mimeType: 'image/png', size: 1024 });

test('accepts eight references and rejects the ninth', () => {
  assert.equal(validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 8 }, (_, i) => file(i)),
  }).references.length, 8);
  assert.throws(() => validateImageDraftInput({
    prompt: 'cinematic fox', model: 'gpt-image-2', ratio: '16:9', references: Array.from({ length: 9 }, (_, i) => file(i)),
  }), /最多 8 张参考图/);
});

test('rejects unsupported reference types', () => {
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [{ name: 'x.gif', mimeType: 'image/gif', size: 10 }],
  }), /JPEG、PNG 或 WebP/);
});

test('accepts 7,000,000 bytes per file and rejects 7,000,001', () => {
  assert.equal(validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [{ ...file(0), size: 7_000_000 }],
  }).references.length, 1);
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [{ ...file(0), size: 7_000_001 }],
  }), /单张参考图不能超过 7MB/);
});

test('accepts 28,000,000 total bytes and rejects 28,000,001', () => {
  assert.equal(validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: Array.from({ length: 4 }, (_, i) => ({ ...file(i), size: 7_000_000 })),
  }).references.length, 4);
  assert.throws(() => validateImageDraftInput({
    prompt: 'x', model: 'gpt-image-2', ratio: '1:1', references: [
      ...Array.from({ length: 4 }, (_, i) => ({ ...file(i), size: 7_000_000 })),
      { ...file(4), size: 1 },
    ],
  }), /总大小不能超过 28MB/);
});

test('skill instructions are snapshotted into the effective image prompt', () => {
  const result = validateImageDraftInput({
    prompt: '  a fox in snow  ', model: 'gpt-image-2', ratio: '16:9', references: [],
    skill: { name: '  电影感  ', content: '  Use anamorphic composition and cold rim light.  ' },
  });
  assert.deepEqual(result.skill, { name: '电影感', content: 'Use anamorphic composition and cold rim light.' });
  assert.match(result.effectivePrompt, /电影感/);
  assert.match(result.effectivePrompt, /anamorphic composition/);
  assert.match(result.effectivePrompt, /User image request:\na fox in snow$/);
});

test('reference paths include owner, task, padded sequence and MIME extension', () => {
  assert.equal(referencePathFor('user-1', 'task-9', 0, 'image/jpeg'), 'user-1/image-tasks/task-9/references/01.jpg');
  assert.equal(referencePathFor('user-1', 'task-9', 8, 'image/png'), 'user-1/image-tasks/task-9/references/09.png');
  assert.equal(referencePathFor('user-1', 'task-9', 11, 'image/webp'), 'user-1/image-tasks/task-9/references/12.webp');
});
