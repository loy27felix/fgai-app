import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseMarkdownSource } from '../../reference/infinite-canvas/src/services/api/prompt-source-runtime';

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

test('canvas reference chips support in-place replacement and the expanded prompt editor keeps every reference action usable', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const promptInput = read('reference/infinite-canvas/src/components/canvas/canvas-prompt-chip-input.tsx');

  assert.match(project, /\[canvas reference replacement\] selection started/);
  assert.match(project, /\[canvas reference replaced\]/);
  assert.match(project, /getCanvasResourceKind\(candidate\)/);
  assert.match(project, /提示词中的 @ 引用已同步/);
  assert.match(promptPanel, /onBeginReferenceReplacement/);
  assert.match(promptPanel, /点击后在画布中替换/);
  assert.match(promptPanel, /onRemove=\{onRemoveReference\}/);
  assert.match(promptPanel, /onSelect=\{onBeginReferenceSelection\}/);
  assert.match(promptPanel, /onReplace=\{onBeginReferenceReplacement\}/);
  assert.doesNotMatch(promptPanel, /↵ 换行/);
  assert.match(promptInput, /z-\[1200\]/);
});

test('canvas wheel keeps zoom while modifier gestures pan the viewport', () => {
  const canvas = read('reference/infinite-canvas/src/components/canvas/infinite-canvas.tsx');

  assert.match(canvas, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(canvas, /"vertical-pan"/);
  assert.match(canvas, /event\.shiftKey/);
  assert.match(canvas, /"horizontal-pan"/);
  assert.match(canvas, /\[canvas wheel navigation\]/);
  assert.match(canvas, /Math\.pow\(1\.1, delta \/ 100\)/);
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

test('canvas video assets retain a durable playback path and surface a recoverable playback state', () => {
  const assetClient = read('reference/infinite-canvas/src/services/api/canvas-assets.ts');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const panel = read('reference/infinite-canvas/src/components/canvas/canvas-side-panel.tsx');
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');

  assert.match(assetClient, /\/api\/creator\/canvas-assets/);
  assert.match(project, /uploadCanvasAsset/);
  assert.match(project, /cloudStoragePath/);
  assert.match(panel, /onPointerEnter/);
  assert.match(panel, /video\.play\(\)/);
  assert.match(node, /视频暂时无法播放/);
  assert.match(node, /\[canvas video playback failed\]/);
});

test('canvas release notes and prompt sources are owned by FG Studio', () => {
  const version = read('reference/infinite-canvas/src/constant/env.ts');
  const release = read('reference/infinite-canvas/src/lib/fg-release-notes.ts');
  const versionCheck = read('reference/infinite-canvas/src/hooks/use-version-check.ts');
  const sources = read('reference/infinite-canvas/src/services/api/prompt-source-presets.ts');

  assert.match(version, /SYSTEM_VERSION/);
  assert.match(release, /本次修改/);
  assert.match(release, /生成前确认/);
  assert.match(release, /AI 对话历史/);
  assert.doesNotMatch(versionCheck, /basketikun\/infinite-canvas/);
  assert.match(sources, /youmind-seedance-2-prompts/);
  assert.match(sources, /awesome-seedance-2-prompts/);
  assert.doesNotMatch(sources, /davidwu-gpt-image2-prompts/);
  assert.doesNotMatch(sources, /awesome-gpt4o-image-prompts/);
});

test('canvas shortcut guides include modifier-wheel panning and generation input behavior', () => {
  const topBar = read('reference/infinite-canvas/src/components/canvas/canvas-top-bar.tsx');
  const zoom = read('reference/infinite-canvas/src/components/canvas/canvas-zoom-controls.tsx');

  for (const guide of [topBar, zoom]) {
    assert.match(guide, /Ctrl \/ Cmd.*滚轮/);
    assert.match(guide, /Shift.*滚轮/);
    assert.match(guide, /回车/);
    assert.match(guide, /开始生成/);
  }
});

test('canvas reference strip reorders source connections so image labels follow the dragged order', () => {
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(promptPanel, /draggable=/);
  assert.match(promptPanel, /onDragStart/);
  assert.match(promptPanel, /onDrop/);
  assert.match(promptPanel, /event\.altKey/);
  assert.match(promptPanel, /ArrowLeft/);
  assert.match(promptPanel, /onReorderReference/);
  assert.match(project, /handleReferenceReorder/);
  assert.match(project, /\[canvas reference reordered\]/);
});

test('markdown prompt sources retain paired HTML video outputs and thumbnail previews', () => {
  const items = parseMarkdownSource(`
### No. 1: Video prompt

#### Prompt
\`\`\`
make a short film
\`\`\`

#### Video
<a href="https://github.com/example/repo/releases/download/videos/example.mp4">
<img src="https://media.example.com/thumbnails/example.jpg" alt="Generated video">
</a>
`, {
    id: 'example-video-prompts',
    name: 'Example video prompts',
    url: 'https://raw.githubusercontent.com/example/repo/main/README.md',
    homepage: 'https://github.com/example/repo',
    enabled: true,
    builtIn: true,
    format: 'markdown',
  });

  assert.equal(items.length, 1);
  assert.match(items[0].coverUrl, /prompt-image\?url=/);
  assert.deepEqual(items[0].referenceImageUrls, [items[0].coverUrl]);
  assert.deepEqual(items[0].previewMedia, [
    { kind: 'video', url: 'https://github.com/example/repo/releases/download/videos/example.mp4' },
    { kind: 'image', url: items[0].coverUrl },
  ]);
});

test('prompt source cache invalidates records parsed before preview media support', () => {
  const prompts = read('reference/infinite-canvas/src/services/api/prompts.ts');

  assert.match(prompts, /prompt-cache-v2/);
});

test('stale prompt source caches wait for refreshed preview data before rendering', () => {
  const prompts = read('reference/infinite-canvas/src/services/api/prompts.ts');
  const cachedBranch = prompts.slice(prompts.indexOf('async function getSourcePrompts'), prompts.indexOf('async function getAllPrompts'));

  assert.match(cachedBranch, /await getOrStartRefresh\(source\)/);
  assert.doesNotMatch(cachedBranch, /void getOrStartRefresh\(source\)/);
});
