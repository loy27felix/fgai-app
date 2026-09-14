import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("generated media uses creator-assets as its final owner instead of IndexedDB", () => {
  const imageStorage = read("reference/infinite-canvas/src/services/image-storage.ts");
  const videoApi = read("reference/infinite-canvas/src/services/api/video.ts");
  const audioApi = read("reference/infinite-canvas/src/services/api/audio.ts");
  const project = read("reference/infinite-canvas/src/pages/canvas/project.tsx");

  assert.match(imageStorage, /persistGeneratedCanvasAsset\(image\.dataUrl/);
  assert.match(videoApi, /persistGeneratedCanvasAsset\(source/);
  assert.match(audioApi, /persistGeneratedCanvasAsset\(audio/);
  assert.match(project, /kind: "audio", source: "upload"/);
  assert.match(project, /previewImage\(file\)/);
  assert.match(project, /previewMediaFile\(file\)/);
  assert.doesNotMatch(project, /uploadImage\(file\)/);
  assert.doesNotMatch(project, /uploadMediaFile\(file, "video"\)/);
  assert.doesNotMatch(project, /void storeGeneratedVideo\(/);
});

test("a stale video request cannot restore a newer completed node to loading", () => {
  const project = read("reference/infinite-canvas/src/pages/canvas/project.tsx");

  assert.match(project, /generationAttemptId: videoAttemptId/);
  assert.match(project, /generationAttemptId === videoAttemptId/);
  assert.match(project, /retryVideoAttemptId/);
  assert.match(project, /durableArchivePending/);
});

test("all current upload and workbench entry points save new media to creator-assets", () => {
  const imageWorkbench = read("reference/infinite-canvas/src/pages/image/index.tsx");
  const videoWorkbench = read("reference/infinite-canvas/src/pages/video/index.tsx");
  const materialLibrary = read("reference/infinite-canvas/src/components/canvas/canvas-side-panel.tsx");
  const assetLibrary = read("reference/infinite-canvas/src/components/canvas/canvas-assets-tab.tsx");
  const agentPanel = read("reference/infinite-canvas/src/components/agent/local-agent-panel.tsx");

  for (const source of [imageWorkbench, videoWorkbench, materialLibrary, assetLibrary, agentPanel]) {
    assert.doesNotMatch(source, /uploadImage\(/);
    assert.doesNotMatch(source, /uploadMediaFile\(/);
  }
  assert.match(imageWorkbench, /persistCanvasImage/);
  assert.match(imageWorkbench, /storeGeneratedImage/);
  assert.match(videoWorkbench, /persistCanvasMedia/);
  assert.match(videoWorkbench, /storeGeneratedVideo/);
  assert.match(materialLibrary, /persistCanvasMedia/);
  assert.match(agentPanel, /persistCanvasImage/);
});
