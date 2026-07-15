import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOwnedReferencePath,
  isCreatorImageTerminal,
  referencePathFor,
  validateStoredImageDraftRequest,
  validateImageDraftInput,
} from '../../lib/creator/image';

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

test('reference paths are task and user scoped without prefix or traversal bypasses', () => {
  assert.doesNotThrow(() => assertOwnedReferencePath('u1/image-tasks/t1/references/01.png', 'u1', 't1'));

  for (const path of [
    'u2/image-tasks/t1/references/01.png',
    'u1-other/image-tasks/t1/references/01.png',
    'u1/image-tasks/t1-other/references/01.png',
    'u1/image-tasks/t1/references/.',
    'u1/image-tasks/t1/references/..',
    'u1/image-tasks/t1/references/../result.png',
    'u1/image-tasks/t1/references/subdir/../../result.png',
    'u1\\image-tasks\\t1\\references\\01.png',
  ]) {
    assert.throws(() => assertOwnedReferencePath(path, 'u1', 't1'), /\u4e0d\u5c5e\u4e8e\u5f53\u524d\u4efb\u52a1/);
  }
});

test('only settled image task statuses are terminal', () => {
  assert.equal(isCreatorImageTerminal('succeeded'), true);
  assert.equal(isCreatorImageTerminal('failed'), true);
  assert.equal(isCreatorImageTerminal('expired'), true);
  assert.equal(isCreatorImageTerminal('draft'), false);
  assert.equal(isCreatorImageTerminal('submitting'), false);
  assert.equal(isCreatorImageTerminal('unknown'), false);
});

function storedRequest(references: Array<{ name: string; mimeType: string; size: number }>) {
  const validated = validateImageDraftInput({
    prompt: 'a fox',
    model: 'gpt-image-2',
    ratio: '1:1',
    references: [],
    skill: { name: 'cinematic', content: 'Use rim light.' },
  });
  return {
    prompt: validated.prompt,
    effective_prompt: validated.effectivePrompt,
    skill: validated.skill,
    ratio: validated.ratio,
    size: validated.size,
    reference_manifest: references,
    reference_paths: [],
    uploads_complete: false,
  };
}

test('stored draft validation accepts all legal manifest boundaries', () => {
  const references = Array.from({ length: 8 }, (_, index) => ({
    name: `${index}.png`,
    mimeType: 'image/png',
    size: index === 0 ? 7_000_000 : 3_000_000,
  }));
  assert.equal(validateStoredImageDraftRequest('gpt-image-2', storedRequest(references)).references.length, 8);
});

test('stored draft validation rejects owner-tampered manifest limits and MIME', () => {
  const cases = [
    Array.from({ length: 9 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', size: 1 })),
    [{ name: 'large.png', mimeType: 'image/png', size: 7_000_001 }],
    [
      ...Array.from({ length: 4 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', size: 7_000_000 })),
      { name: 'extra.png', mimeType: 'image/png', size: 1 },
    ],
    [{ name: 'payload.gif', mimeType: 'image/gif', size: 1 }],
  ];
  for (const references of cases) {
    assert.throws(() => validateStoredImageDraftRequest('gpt-image-2', storedRequest(references)));
  }
});

test('stored draft validation rejects invalid model, ratio and effective prompt snapshots', () => {
  const request = storedRequest([{ name: 'a.png', mimeType: 'image/png', size: 1 }]);
  assert.throws(() => validateStoredImageDraftRequest('unknown-model', request));
  assert.throws(() => validateStoredImageDraftRequest('gpt-image-2', { ...request, ratio: '10:1' }));
  assert.throws(() => validateStoredImageDraftRequest('gpt-image-2', { ...request, effective_prompt: 'tampered' }));
});
