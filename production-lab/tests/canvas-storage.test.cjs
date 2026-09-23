const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCanvasGraph } = require('./.build/canvas-storage.js');

const node = (id, extra = {}) => ({ id, kind: 'text', title: '标题', text: '内容', x: 0, y: 0, skillIds: [], ...extra });

test('server canvas validation accepts typed nodes and removes duplicate skill references', () => {
  const graph = validateCanvasGraph({ nodes: [node('a', { skillIds: ['acting', 'acting'] }), node('b', { kind: 'video' })], edges: [{ from: 'a', to: 'b' }] });
  assert.deepEqual(graph.nodes[0].skillIds, ['acting']);
  assert.deepEqual(graph.edges, [{ from: 'a', to: 'b' }]);
});

test('server canvas validation rejects duplicate IDs, invalid nodes, and dangling edges', () => {
  assert.throws(() => validateCanvasGraph({ nodes: [node('a'), node('a')], edges: [] }), /重复/);
  assert.throws(() => validateCanvasGraph({ nodes: [node('a', { kind: 'shell' })], edges: [] }), /内容无效/);
  assert.throws(() => validateCanvasGraph({ nodes: [node('a')], edges: [{ from: 'a', to: 'missing' }] }), /连线引用无效/);
});
