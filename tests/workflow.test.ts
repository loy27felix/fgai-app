import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGES } from '../lib/types';

test('production workflow has seven stages and no splice/export stage', () => {
  assert.equal(STAGES.length, 7);
  assert.deepEqual(STAGES.map((stage) => stage.key), ['bible', 'script', 'assets', 'board', 'shots', 'video', 'bgm']);
  assert.equal(STAGES.some((stage) => /export|拼接/.test(`${stage.key}${stage.label}`)), false);
});
