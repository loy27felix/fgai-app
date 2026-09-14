import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { updateCreatorCanvas } from '../../lib/creator/canvas-client';

test('a canvas save sends the version it was based on', async () => {
  const previousFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || '');
    return new Response(JSON.stringify({ canvas: { id: 'canvas-1', version: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await updateCreatorCanvas('canvas-1', {
      title: '分镜画布',
      graph: { nodes: [], edges: [] },
      expectedVersion: 7,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(JSON.parse(requestBody), {
    title: '分镜画布',
    graph: { nodes: [], edges: [] },
    expectedVersion: 7,
  });
});

test('the canvas API rejects an older full-graph write instead of silently overwriting it', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/canvases/[id]/route.ts'), 'utf8');

  assert.match(route, /expectedVersion/);
  assert.match(route, /\.eq\('version', expectedVersion\)/);
  assert.match(route, /CANVAS_VERSION_CONFLICT/);
});
