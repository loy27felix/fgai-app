import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeCanvasCloudGraphs } from '../reference/infinite-canvas/src/lib/canvas/canvas-cloud-merge';

test('a version-conflict retry preserves nodes and edges added by either canvas session', () => {
  const merged = mergeCanvasCloudGraphs(
    {
      nodes: [{ id: 'a', title: '本地已修改' }, { id: 'c', title: '本地新素材' }],
      edges: [{ from: 'c', to: 'a' }],
      viewport: { x: 80, y: 40, zoom: 1.2 },
    },
    {
      nodes: [{ id: 'a', title: '远端旧标题' }, { id: 'b', title: '另一设备新增视频' }],
      edges: [{ from: 'a', to: 'b' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  );

  assert.deepEqual(merged.nodes, [
    { id: 'a', title: '本地已修改' },
    { id: 'b', title: '另一设备新增视频' },
    { id: 'c', title: '本地新素材' },
  ]);
  assert.deepEqual(merged.edges, [{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }]);
  assert.deepEqual(merged.viewport, { x: 80, y: 40, zoom: 1.2 });
});
