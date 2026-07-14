import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitialCanvasGraph } from '../lib/canvas';

test('shot canvas seeds reference, prompt and generator with valid edges', () => {
  const graph = buildInitialCanvasGraph({
    imageUrl: 'https://example.com/keyframe.jpg',
    prompt: 'cinematic close-up',
  });
  assert.deepEqual(graph.nodes.map((node) => node.kind), ['ref', 'prompt', 'gen']);
  assert.deepEqual(graph.edges, [
    { from: 'seed-ref', to: 'seed-gen' },
    { from: 'seed-prompt', to: 'seed-gen' },
  ]);
});

test('empty canvas input stays empty instead of creating unusable nodes', () => {
  assert.deepEqual(buildInitialCanvasGraph({}), { nodes: [], edges: [] });
});

test('shot canvas adds a separate prompt-to-video lane when a video prompt exists', () => {
  const graph = buildInitialCanvasGraph({
    imageUrl: 'https://example.com/keyframe.jpg',
    prompt: 'still image prompt',
    videoPrompt: 'camera pushes toward the subject',
  });
  assert.deepEqual(graph.nodes.map((node) => node.kind), ['ref', 'prompt', 'gen', 'prompt', 'video']);
  assert.deepEqual(graph.edges.slice(-2), [
    { from: 'seed-ref', to: 'seed-video' },
    { from: 'seed-video-prompt', to: 'seed-video' },
  ]);
});
