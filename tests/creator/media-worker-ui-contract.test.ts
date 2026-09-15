import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("canvas replaces the placeholder super-resolution modal with a worker job flow", () => {
    const source = fs.readFileSync("reference/infinite-canvas/src/pages/canvas/project.tsx", "utf8");
    assert.doesNotMatch(source, /暂未实现/);
    assert.match(source, /MediaProcessingDialog/);
    assert.match(source, /mediaProcessingJobId/);
});

test("local processing UI only uses durable asset IDs and same-origin result URLs", () => {
    const dialog = fs.readFileSync("reference/infinite-canvas/src/components/canvas/media-processing-dialog.tsx", "utf8");
    const factory = fs.readFileSync("reference/infinite-canvas/src/lib/canvas/canvas-node-factory.ts", "utf8");
    assert.match(dialog, /cloudAssetId/);
    assert.match(dialog, /uploadCanvasAsset/);
    assert.match(factory, /derivedMediaMetadata/);
    assert.match(factory, /cloudStoragePath/);
    assert.doesNotMatch(factory, /storageKey: input\.storagePath/);
});
