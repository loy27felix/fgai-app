import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithConcurrency } from '../reference/infinite-canvas/src/lib/canvas/canvas-video-recovery';

test('bounds canvas recovery workers and processes every unique task', async () => {
  const items = Array.from({ length: 19 }, (_, index) => index);
  const seen: number[] = [];
  let active = 0;
  let peak = 0;
  await runWithConcurrency(items, 4, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, item % 3));
    seen.push(item);
    active -= 1;
  });
  assert.equal(seen.length, items.length);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
  assert.ok(peak <= 4);
});

test('normalizes invalid concurrency to one worker', async () => {
  const seen: number[] = [];
  await runWithConcurrency([1, 2, 3], 0, async (item) => {
    seen.push(item);
  });
  assert.deepEqual(seen, [1, 2, 3]);
});
