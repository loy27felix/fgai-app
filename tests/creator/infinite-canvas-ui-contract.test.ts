import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('infinite canvas keeps reference theme variables scoped to the mounted host', () => {
  const host = read('components/creator/InfiniteCanvasReferenceHost.tsx');
  const styles = read('app/globals.css');

  assert.match(host, /fg-reference-root/);
  assert.match(styles, /\.dark \.fg-reference-root\s*\{/);
});

test('canvas projects and nodes expose explicit duplicate actions', () => {
  const store = read('reference/infinite-canvas/src/stores/canvas/use-canvas-store.ts');
  const projects = read('reference/infinite-canvas/src/components/canvas/canvas-project-card.tsx');
  const topBar = read('reference/infinite-canvas/src/components/canvas/canvas-top-bar.tsx');
  const contextMenu = read('reference/infinite-canvas/src/components/canvas/canvas-context-menu.tsx');
  const toolbar = read('reference/infinite-canvas/src/components/canvas/canvas-node-hover-toolbar.tsx');

  assert.match(store, /duplicateProject/);
  assert.match(projects, /创建副本/);
  assert.match(topBar, /onDuplicateProject/);
  assert.match(contextMenu, /创建副本/);
  assert.match(toolbar, /创建节点副本/);
});

test('model picker preserves full model labels and responsive width', () => {
  const picker = read('reference/infinite-canvas/src/components/model-picker.tsx');
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const styles = read('app/globals.css');

  assert.match(picker, /title=\{modelOptionLabel\(config, model\)\}/);
  assert.match(picker, /whitespace-normal break-all/);
  assert.doesNotMatch(promptPanel, /max-w-\[190px\]/);
  assert.match(styles, /canvas-model-picker-node/);
});

test('canvas Agent is wired to the creator chat API with skills and reasoning', () => {
  const agent = read('reference/infinite-canvas/src/components/agent/local-agent-panel.tsx');
  const api = read('app/api/creator/chat/route.ts');

  assert.match(agent, /\/api\/creator\/chat/);
  assert.match(agent, /thinking/);
  assert.match(agent, /skill/);
  assert.match(api, /recordUsageBestEffort/);
});
