const { test } = require('node:test');
const assert = require('node:assert/strict');
const { zoomAtPoint, nextDraftPosition } = require('./.build/canvas-interactions.js');
const { createDraft } = require('./.build/canvas-draft.js');

test('cursor anchored zoom keeps the world point under the pointer fixed', () => {
  const viewport = { x: 30, y: -12, k: 0.6 };
  const point = { x: 300, y: 220 };
  const before = { x: (point.x - viewport.x) / viewport.k, y: (point.y - viewport.y) / viewport.k };
  const next = zoomAtPoint(viewport, point, -160);
  assert.notEqual(next.k, viewport.k);
  assert.ok(Math.abs((point.x - next.x) / next.k - before.x) < 1e-9);
  assert.ok(Math.abs((point.y - next.y) / next.k - before.y) < 1e-9);
});

test('adding a node finds a visible unoccupied canvas slot', () => {
  const nodes = Array.from({ length: 3 }, (_, i) => createDraft('text', String(i), '', 20 + i * 300, 40));
  const position = nextDraftPosition({ nodes, edges: [] }, { x: 0, y: 0, k: 1 }, { x: 20, y: 40 });
    assert.ok(!nodes.some(node => position.x < node.x + 320 && position.x + 320 > node.x && position.y < node.y + 420 && position.y + 420 > node.y));
});
