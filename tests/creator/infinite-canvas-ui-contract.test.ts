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


test('canvas cloud sync adopts legacy local projects and deletes remote rows', () => {
  const index = read('reference/infinite-canvas/src/pages/canvas/index.tsx');
  const dialog = read('reference/infinite-canvas/src/components/canvas/canvas-delete-projects-dialog.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(index, /matchesRemoteCanvas/);
  assert.match(index, /useCanvasStore\.getState\(\)\.projects/);
  assert.match(index, /uniqueRemote/);
  assert.match(dialog, /deleteCreatorCanvas/);
  assert.match(dialog, /云端副本也会同步删除/);
  assert.match(project, /cloudCreateInFlightRef/);
});

test('creator browser history bridge and reference-id recovery are wired', () => {
  const host = read('components/creator/InfiniteCanvasReferenceHost.tsx');
  const route = read('app/api/creator/videos/[id]/route.ts');

  assert.match(host, /BrowserHistoryBridge/);
  assert.match(host, /pushState/);
  assert.match(host, /initialCreatorRoute/);
  assert.match(route, /allowExternalTaskId/);
  assert.match(route, /external_task_id/);
  assert.match(route, /fresh URL can be copied/);
});

test('legacy canvas deep links and video recovery routes remain available', () => {
  const root = read('app/canvas/page.tsx');
  const project = read('app/canvas/[...slug]/page.tsx');
  const route = read('app/api/creator/videos/[id]/route.ts');
  const video = read('reference/infinite-canvas/src/pages/video/index.tsx');

  assert.match(root, /\/creator#\/canvas/);
  assert.match(project, /\/creator#\/canvas/);
  assert.match(route, /loadOwnedLegacyTask/);
  assert.match(route, /recoverLegacyTask/);
  assert.match(video, /getVideoTaskByReferenceId/);
  assert.match(video, /查询并找回/);
});

test('reference-id recovery skips UUID-only task predicates', () => {
  const route = read('app/api/creator/videos/[id]/route.ts');

  assert.match(route, /function isUuid\(value: string\)/);
  assert.match(route, /if \(isUuid\(id\)\) \{[\s\S]*?\.eq\('id', id\)/);
  assert.match(route, /if \(!task && allowExternalTaskId\) \{[\s\S]*?\.eq\('external_task_id', id\)/);
});

test('video persistence keeps a cloud URL when browser media storage is unavailable', () => {
  const video = read('reference/infinite-canvas/src/services/api/video.ts');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(video, /return \{ blob: response\.data, url, mimeType:/);
  assert.match(video, /const fallbackUrl = result\.fallbackUrl/);
  assert.match(video, /storageKey: ""/);
  assert.match(video, /return remoteFallback;/);
  assert.match(project, /storeGeneratedVideo\(\{[\s\S]*?url: task\.videoUrl/);
});
