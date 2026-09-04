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

test('company-model Skill video production stays in a user-confirmed canvas workflow', () => {
  const agent = read('reference/infinite-canvas/src/components/agent/local-agent-panel.tsx');
  const flow = read('reference/infinite-canvas/src/components/agent/company-video-skill-flow.tsx');
  const route = read('app/api/creator/canvas-agent/video-plan/route.ts');

  assert.match(agent, /CompanyVideoSkillFlow/);
  assert.match(agent, /\/api\/creator\/canvas-agent\/video-plan/);
  assert.match(agent, /canvasContext\.applyOps/);
  assert.match(agent, /type: "run_generation"/);
  assert.match(agent, /mode: "video"/);
  assert.match(agent, /startNewConversation/);
  assert.match(agent, /deleteTarget/);
  assert.match(agent, /runSkillVideoSequence/);
  assert.match(flow, /视频模型/);
  assert.match(flow, /预计总价/);
  assert.match(flow, /分镜图/);
  assert.match(flow, /视频段数/);
  assert.match(route, /selectedSkills/);
  assert.match(route, /segmentCount/);
  assert.match(route, /estimateCompanyVideoProduction/);
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

test('native node prompt workspaces expose a plugin hook without globally changing their scale', () => {
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const promptInput = read('reference/infinite-canvas/src/components/canvas/canvas-prompt-chip-input.tsx');
  const workspaceRoot = promptPanel.slice(promptPanel.indexOf('return ('), promptPanel.indexOf('<ReferenceStrip'));

  assert.match(workspaceRoot, /data-canvas-prompt-workspace/);
  assert.doesNotMatch(workspaceRoot, /--fg-prompt-studio-workspace-scale/);
  assert.doesNotMatch(workspaceRoot, /transform: `scale/);
  assert.match(workspaceRoot, /data-canvas-no-zoom/);
  assert.match(workspaceRoot, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(promptInput, /data-canvas-no-zoom/);
  assert.doesNotMatch(promptInput, /onWheelCapture/);
});

test('canvas pastes externally copied images through the native HTTP-compatible clipboard event', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const pasteStart = project.indexOf('const handlePaste');
  const pasteEnd = project.indexOf('useEffect(() => {', pasteStart);
  const pasteHandler = project.slice(pasteStart, pasteEnd);

  assert.match(project, /const handlePaste = useCallback\(\s*\(event: ClipboardEvent\)/);
  assert.match(project, /event\.clipboardData/);
  assert.match(project, /clipboardData\?\.items/);
  assert.match(project, /CANVAS_CLIPBOARD_MIME/);
  assert.match(project, /shouldIgnoreCanvasClipboardTarget\(target\)/);
  assert.doesNotMatch(pasteHandler, /data-canvas-no-zoom/);
  assert.match(project, /window\.addEventListener\("paste", handlePaste, true\)/);
  assert.match(project, /window\.addEventListener\("copy", handleCopy\)/);
  assert.doesNotMatch(project, /navigator\.clipboard\.read/);
});

test('canvas appearance exposes a custom background upload with independent image and grid opacity controls', () => {
  const toolbar = read('reference/infinite-canvas/src/components/canvas/canvas-toolbar.tsx');
  const canvas = read('reference/infinite-canvas/src/components/canvas/infinite-canvas.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const providers = read('reference/infinite-canvas/src/components/layout/app-providers.tsx');

  assert.match(toolbar, /自定义/);
  assert.match(toolbar, /上传背景/);
  assert.match(toolbar, /背景透明度/);
  assert.match(toolbar, /网格透明度/);
  assert.match(canvas, /customBackgroundUrl/);
  assert.match(canvas, /customBackgroundOpacity/);
  assert.match(canvas, /gridOpacity/);
  assert.match(project, /uploadCanvasAsset\(file, \{ kind: "image", source: "upload", name: file\.name \}\)/);
  assert.match(providers, /dark \? "dark" : "light"/);
});

test('canvas image copy writes a user-activated image payload instead of using legacy DOM selection copy', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const imageClipboard = read('reference/infinite-canvas/src/lib/canvas/canvas-image-clipboard.ts');

  assert.match(imageClipboard, /new ClipboardItemClass\(\{ "image\/png": pngPromise \}\)/);
  assert.doesNotMatch(imageClipboard, /execCommand\("copy"\)/);
  assert.doesNotMatch(project, /isCanvasNativeImageCopyInFlight/);
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

test('image reruns stay in one node and never promote their previous result into an implicit reference', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');

  assert.match(project, /if \(isImageNode && !isEmptyImageNode && sourceNode\)/);
  assert.match(project, /appendImageAlternative/);
  assert.match(project, /referenceImages: hydratedGenerationContext\.referenceImages\.filter/);
  assert.doesNotMatch(project, /const sourceReference/);
  assert.match(project, /\[canvas image alternative selected\]/);
  assert.match(node, /第 \{index \+ 1\} 个图片版本/);
  assert.match(node, /onImageAlternativeChange/);
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

test('replacing a canvas video creates a fresh cloud backup instead of retaining stale metadata', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const replacementStart = project.indexOf('else if (first.type.startsWith("video/"))');
  const replacementEnd = project.indexOf('} else {', replacementStart);
  const replacement = project.slice(replacementStart, replacementEnd);

  assert.ok(replacementStart >= 0);
  assert.match(replacement, /uploadCanvasAsset\(first/);
  assert.match(replacement, /cloudStoragePath/);
  assert.match(replacement, /cloudAssetId/);
});

test('uploaded and replaced canvas images receive their own durable cloud asset', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const imageCreation = project.slice(project.indexOf('const createImageFileNode'), project.indexOf('const createVideoFileNode'));
  const imageReplacementStart = project.indexOf('const image = await uploadImage(first);');
  const imageReplacement = project.slice(imageReplacementStart, project.indexOf('// 剩余文件', imageReplacementStart));

  assert.match(imageCreation, /uploadCanvasAsset\(file, \{ kind: "image"/);
  assert.match(imageCreation, /cloudStoragePath/);
  assert.match(imageReplacement, /uploadCanvasAsset\(first, \{ kind: "image"/);
  assert.match(imageReplacement, /creatorTaskId: undefined/);
});

test('image copying is an image-node context-menu action rather than a hovering toolbar action', () => {
  const contextMenu = read('reference/infinite-canvas/src/components/canvas/canvas-context-menu.tsx');
  const hoverToolbar = read('reference/infinite-canvas/src/components/canvas/canvas-node-hover-toolbar.tsx');
  const imageTools = read('reference/infinite-canvas/src/components/canvas/canvas-image-toolbar-tools.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(contextMenu, /onCopyImage/);
  assert.match(contextMenu, /label="复制图片"/);
  assert.match(project, /onCopyImage=\{\(\) =>/);
  assert.doesNotMatch(hoverToolbar, /copyCanvasImageToClipboard/);
  assert.doesNotMatch(imageTools, /id: "copyImage"/);
});

test('canvas release notes and prompt sources are owned by FG Studio', () => {
  const version = read('reference/infinite-canvas/src/constant/env.ts');
  const release = read('reference/infinite-canvas/src/lib/fg-release-notes.ts');
  const versionCheck = read('reference/infinite-canvas/src/hooks/use-version-check.ts');
  const sources = read('reference/infinite-canvas/src/services/api/prompt-source-presets.ts');

  assert.match(version, /SYSTEM_VERSION/);
  assert.match(release, /更新内容/);
  assert.match(release, /生成前确认/);
  assert.match(release, /AI 对话历史/);
  assert.doesNotMatch(versionCheck, /basketikun\/infinite-canvas/);
  assert.match(sources, /youmind-seedance-2-prompts/);
  assert.match(sources, /awesome-seedance-2-prompts/);
  assert.doesNotMatch(sources, /davidwu-gpt-image2-prompts/);
  assert.doesNotMatch(sources, /awesome-gpt4o-image-prompts/);
});

test('material library remains separate from assets and previews video references as video media', () => {
  const store = read('reference/infinite-canvas/src/stores/use-asset-store.ts');
  const materialStore = read('reference/infinite-canvas/src/stores/use-material-library-store.ts');
  const sidePanel = read('reference/infinite-canvas/src/components/canvas/canvas-side-panel.tsx');
  const picker = read('reference/infinite-canvas/src/components/canvas/asset-picker-modal.tsx');
  const materialPicker = read('reference/infinite-canvas/src/components/canvas/material-library-picker-modal.tsx');
  const materialTab = read('reference/infinite-canvas/src/components/canvas/canvas-material-library-tab.tsx');
  const contextMenu = read('reference/infinite-canvas/src/components/canvas/canvas-context-menu.tsx');
  const promptPanel = read('reference/infinite-canvas/src/components/canvas/canvas-node-prompt-panel.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const uploadRoute = read('app/api/creator/canvas-assets/route.ts');

  assert.match(store, /AssetKind = "text" \| "image" \| "video"/);
  assert.doesNotMatch(store, /library_folder/);
  assert.match(materialStore, /MaterialKind = "image" \| "video" \| "audio"/);
  assert.match(materialStore, /MATERIAL_LIBRARY_DRAG_MIME/);
  assert.match(sidePanel, /素材库/);
  assert.match(sidePanel, /TabButton label="资产"/);
  assert.match(sidePanel, /CanvasMaterialLibraryTab/);
  assert.match(picker, /<video/);
  assert.match(materialPicker, /<video/);
  assert.match(materialPicker, /<Select/);
  assert.match(materialTab, /删除素材/);
  assert.match(materialTab, /deleteMaterialLibraryAsset/);
  assert.match(materialTab, /moveMaterialLibraryAsset/);
  assert.match(promptPanel, /onSelectFromLibrary/);
  assert.match(project, /MaterialLibraryPickerModal/);
  assert.match(project, /handleMaterialReferenceInsert/);
  assert.match(project, /saveNodeToMaterialLibrary/);
  assert.match(project, /materialSaveNode/);
  assert.match(project, /选择保存位置/);
  assert.match(contextMenu, /添加到素材库/);
  assert.match(uploadRoute, /library_scope/);
  assert.match(read('app/api/creator/assets/route.ts'), /export async function DELETE/);
  assert.match(read('app/api/creator/assets/route.ts'), /export async function PATCH/);
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

test('failed canvas media nodes keep a direct prompt-editor path without relying on drag completion', () => {
  const node = read('reference/infinite-canvas/src/components/canvas/canvas-node.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(node, /onOpenPrompt\?: \(node: CanvasNodeData\) => void/);
  assert.match(node, /修改提示词/);
  assert.match(node, /onOpenPrompt\?\.\(node\)/);
  assert.match(node, /data\.metadata\?\.status !== "error"/);
  assert.match(project, /onOpenPrompt=\{\(node\) => setDialogNodeId\(node\.id\)\}/);
});

test('new video nodes snapshot model-compatible defaults from the settings dialog', () => {
  const config = read('reference/infinite-canvas/src/stores/use-config-store.ts');
  const dialog = read('reference/infinite-canvas/src/components/layout/app-config-modal.tsx');
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');

  assert.match(config, /newVideoNodeSize/);
  assert.match(config, /newVideoNodeResolution/);
  assert.match(config, /newVideoNodeSeconds/);
  assert.match(config, /"video-node-defaults"/);
  assert.match(dialog, /新建视频节点/);
  assert.match(dialog, /新建节点画幅/);
  assert.match(dialog, /新建节点分辨率/);
  assert.match(dialog, /新建节点时长/);
  assert.match(dialog, /当前默认模型/);
  assert.match(dialog, /videoNodePresetFor/);
  assert.match(dialog, /getVideoModel\(modelId\)/);
  assert.match(dialog, /modelSpec\.resolutions/);
  assert.match(dialog, /modelSpec\?\.minDuration/);
  assert.match(dialog, /requiresAdaptiveFrameRatio/);
  assert.doesNotMatch(dialog, /开源许可与来源/);
  assert.match(project, /type === CanvasNodeType\.Video/);
  assert.match(project, /size: effectiveConfig\.newVideoNodeSize/);
  assert.match(project, /vquality: effectiveConfig\.newVideoNodeResolution/);
  assert.match(project, /seconds: effectiveConfig\.newVideoNodeSeconds/);
});

test('canvas appearance keeps the custom theme label on one line', () => {
  const toolbar = read('reference/infinite-canvas/src/components/canvas/canvas-toolbar.tsx');

  assert.match(toolbar, /targetTheme="custom"/);
  assert.match(toolbar, /whitespace-nowrap/);
});

test('direct canvas Gemini calls use imageConfig and OpenAI image edits submit image[] references', () => {
  const imageApi = read('reference/infinite-canvas/src/services/api/image.ts');
  const pluginTemplates = read('reference/infinite-canvas/src/services/api/model-plugin.ts');

  assert.match(imageApi, /return Object\.keys\(image\)\.length \? \{ imageConfig: image \} : \{\};/);
  assert.doesNotMatch(imageApi, /responseFormat: \{ image \}/);
  assert.match(pluginTemplates, /form\.append\("image\[\]"/);
});

test('canvas refresh ignores blank video drafts and material folder names survive reloads', () => {
  const project = read('reference/infinite-canvas/src/pages/canvas/project.tsx');
  const videoRecovery = read('reference/infinite-canvas/src/lib/canvas/canvas-video-recovery.ts');
  const materialStore = read('reference/infinite-canvas/src/stores/use-material-library-store.ts');
  const materialTab = read('reference/infinite-canvas/src/components/canvas/canvas-material-library-tab.tsx');
  const assetsApi = read('reference/infinite-canvas/src/services/api/canvas-assets.ts');
  const assetsRoute = read('app/api/creator/assets/route.ts');

  assert.match(project, /shouldReportMissingVideoBackup\(node\)/);
  assert.match(videoRecovery, /hasMaterializedVideoOutput/);
  assert.match(videoRecovery, /metadata\?\.content/);
  assert.match(materialStore, /folderName\?: string/);
  assert.match(materialStore, /library_folder_name/);
  assert.match(materialStore, /withoutLegacyUncategorizedFolder/);
  assert.match(materialStore, /ensureFolder\(\{ folders: result \}, item\.folderId, item\.folderName\)/);
  assert.match(materialTab, /renameFolder/);
  assert.match(materialTab, /onRename/);
  assert.match(assetsApi, /renameMaterialLibraryFolder/);
  assert.match(assetsRoute, /library_folder_name/);
  assert.match(assetsRoute, /renameFolder/);
});
