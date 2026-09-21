import assert from 'node:assert/strict';
import test from 'node:test';

import { canvasViewportWorldRect, connectionIntersectsRect, connectionRenderBounds } from '../reference/infinite-canvas/src/lib/canvas/canvas-connection-viewport';

const node = (x: number, y: number, width = 100, height = 80) => ({ position: { x, y }, width, height });

test('computes a conservative cubic connection bound', () => {
  const bounds = connectionRenderBounds(node(100, 100), node(500, 300));
  assert.deepEqual(bounds, { left: 200, top: 140, right: 500, bottom: 340 });
});

test('keeps only connections whose path can reach the viewport', () => {
  const viewport = { left: 0, top: 0, right: 800, bottom: 600 };
  assert.equal(connectionIntersectsRect(node(-500, 100), node(-200, 200), viewport), false);
  assert.equal(connectionIntersectsRect(node(-500, 100), node(100, 200), viewport), true);
  assert.equal(connectionIntersectsRect(node(100, 100), node(500, 300), viewport), true);
});

test('converts the screen viewport to world coordinates', () => {
  assert.deepEqual(canvasViewportWorldRect({ x: -200, y: -100, k: 2 }, 1000, 600), {
    left: 100,
    top: 50,
    right: 600,
    bottom: 350,
  });
});
