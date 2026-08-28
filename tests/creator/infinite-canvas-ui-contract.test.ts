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

test('canvas prompt sources include the upstream GPT Image 2 collection', () => {
  const sources = read('reference/infinite-canvas/src/services/api/prompt-source-presets.ts');

  assert.match(sources, /freestylefly-gpt-image-2/);
  assert.match(sources, /Freestylefly GPT Image 2/);
});

test('canvas adopts stable tool, text-count, resize, and batch-preview interactions', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const canvas = read('reference/infinite-canvas/src/components/canvas/infinite-canvas.tsx');
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');
  const toolbar = read('reference/infinite-canvas/src/components/canvas/canvas-toolbar.tsx');
  const textSettings = read('reference/infinite-canvas/src/components/canvas/canvas-text-settings-popover.tsx');
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');

  assert.match(project, /useState<"select" \| "pan">\("pan"\)/);
  assert.match(project, /tool=\{canvasTool\}/);
  assert.match(canvas, /tool\?: "select" \| "pan"/);
  assert.match(canvas, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(toolbar, /移动模式（Ctrl\/空格框选）/);
  assert.match(project, /metadata\?\.textCount \|\| 1/);
  assert.match(project, /if \(childIds\.length\)/);
  assert.match(textSettings, /文本生成次数/);
  assert.match(project, /showPanel=\{!isNodeResizing/);
  assert.match(node, /onResizeStart\?\./);
  assert.match(node, /onResizeEnd\?\./);
  assert.match(project, /imageBatchExpanded: undefined/);
  assert.match(node, /data\.type === CanvasNodeType\.Image && hasImageContent/);
  assert.match(node, /onViewImage\?\.\(data\)/);
  assert.match(promptPanel, /放大编辑提示词/);
  assert.match(promptPanel, /isPromptEditorOpen/);
  assert.match(promptPanel, /composerContent/);
});

test('canvas pastes externally copied images through the native HTTP-compatible clipboard event', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(project, /const handlePaste = useCallback\(\s*\(event: ClipboardEvent\)/);
  assert.match(project, /event\.clipboardData/);
  assert.match(project, /clipboardData\?\.items/);
  assert.match(project, /CANVAS_CLIPBOARD_MIME/);
  assert.match(project, /window\.addEventListener\("paste", handlePaste, true\)/);
  assert.match(project, /window\.addEventListener\("copy", handleCopy\)/);
  assert.doesNotMatch(project, /navigator\.clipboard\.read/);
});

test('canvas error details wrap and scroll inside narrow portrait nodes', () => {
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');

  assert.match(node, /break-all/);
  assert.match(node, /overflow-y-auto/);
  assert.match(node, /title=\{detail\}/);
});

test('video reruns stay in one node with selectable versions and keyboard deletion remains available for video controls', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');
  const menu = read('reference/infinite-canvas/src/components/canvas/canvas-create-menus.tsx');

  assert.match(project, /const isVideoNode = sourceNode\?\.type === CanvasNodeType\.Video/);
  assert.match(project, /const videoId = isVideoNode \? nodeId : nanoid\(\)/);
  assert.match(project, /appendVideoAlternative/);
  assert.match(project, /\[canvas video alternative selected\]/);
  assert.match(project, /const referenceConnections = sourceConnections/);
  assert.match(project, /\[canvas keyboard delete\]/);
  assert.match(project, /target\?\.closest\("\[contenteditable='true'\],\[data-canvas-shortcuts-ignore\]"\)/);
  assert.match(node, /第 \{index \+ 1\} 个视频版本/);
  assert.match(node, /onVideoAlternativeChange/);
  assert.match(menu, /w-\[360px\]/);
});

test('canvas reference chips support in-place replacement and the expanded prompt editor keeps @ references usable', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const promptInput = read('reference/infinite-canvas/src/components/canvas/canvas-prompt-chip-input.tsx');

  assert.match(project, /\[canvas reference replacement\] selection started/);
  assert.match(project, /\[canvas reference replaced\]/);
  assert.match(project, /getCanvasResourceKind\(candidate\)/);
  assert.match(project, /提示词中的 @ 引用已同步/);
  assert.match(promptPanel, /onBeginReferenceReplacement/);
  assert.match(promptPanel, /点击后在画布中替换/);
  assert.match(promptPanel, /<ReferenceStrip nodeId=\{node\.id\} references=\{mentionReferences\} theme=\{theme\} \/>/);
  assert.doesNotMatch(promptPanel, /↵ 换行/);
  assert.match(promptInput, /z-\[1200\]/);
});

test('canvas restores the original native grab cursor for panning', () => {
  const canvas = read('reference/infinite-canvas/src/components/canvas/infinite-canvas.tsx');

  assert.match(canvas, /cursor-grabbing/);
  assert.match(canvas, /cursor-grab/);
  assert.match(canvas, /document\.body\.style\.cursor = "grabbing"/);
  assert.doesNotMatch(canvas, /function canvasCursor/);
});

test('canvas side panel nests grouped nodes with independently collapsible tree branches', () => {
  const panel = read('reference/infinite-canvas/src/components/canvas/canvas-side-panel.tsx');

  assert.match(panel, /function buildCanvasNodeTree/);
  assert.match(panel, /group tree toggled/);
  assert.match(panel, /role="treeitem"/);
  assert.match(panel, /aria-expanded/);
  assert.match(panel, /children\.length} 个节点/);
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

test('creator browser history bridge is wired without a provider-id recovery route', () => {
  const host = read('components/creator/InfiniteCanvasReferenceHost.tsx');
  const route = read('app/api/creator/videos/[id]/route.ts');

  assert.match(host, /BrowserHistoryBridge/);
  assert.match(host, /pushState/);
  assert.match(host, /initialCreatorRoute/);
  assert.match(route, /if \(!isUuid\(id\)\) return null/);
  assert.doesNotMatch(route, /allowExternalTaskId/);
  assert.doesNotMatch(route, /loadOwnedTask\(context, params\.id, true\)/);
});

test('legacy canvas deep links remain available while old-video recovery UI is removed', () => {
  const root = read('app/canvas/page.tsx');
  const project = read('app/canvas/[...slug]/page.tsx');
  const video = read('reference/infinite-canvas/src/pages/video/index.tsx');
  const canvasProject = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const toolbar = read('reference/infinite-canvas/src/components/canvas/canvas-node-hover-toolbar.tsx');

  assert.match(root, /\/creator#\/canvas/);
  assert.match(project, /\/creator#\/canvas/);
  assert.doesNotMatch(video, /找回旧视频/);
  assert.doesNotMatch(video, /getVideoTaskByReferenceId/);
  assert.doesNotMatch(canvasProject, /handleRecoverVideoNode/);
  assert.doesNotMatch(toolbar, /recoverVideo/);
});

test('remote canvas plugins use the browser native importer, not a bundler blob import', () => {
  const loader = read('reference/infinite-canvas/src/lib/canvas/plugin-loader.ts');

  assert.match(loader, /webpackIgnore: true/);
  assert.match(loader, /await import\(\/\* webpackIgnore: true \*\/ url\)/);
  assert.doesNotMatch(loader, /import\(\/\* @vite-ignore \*\/ url\)/);
});

test('login disables horizontal gesture scrolling while preserving vertical form scrolling', () => {
  const login = read('app/login/page.tsx');
  const styles = read('app/globals.css');

  assert.match(login, /touch-pan-y/);
  assert.match(styles, /overflow-x: clip/);
  assert.match(styles, /overscroll-behavior-x: none/);
});

test('video persistence keeps a cloud URL when browser media storage is unavailable', () => {
  const video = read('reference/infinite-canvas/src/services/api/video.ts');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(video, /return \{ blob: response\.data, url, mimeType:/);
  assert.match(video, /const fallbackUrl = result\.fallbackUrl/);
  assert.match(video, /storageKey: ""/);
  assert.match(video, /return remoteFallback;/);
  assert.match(project, /cloudStoragePath/);
});
