import { expect, test } from "bun:test";
import { buildCanvasAssetCatalog, canvasAssetKind } from "../src/lib/canvas/canvas-asset-catalog";
import { ensureCurrentMediaVersion, recordReplacedMediaVersion } from "../src/lib/canvas/canvas-media-versions";
import { normalizeCanvasUploadFile, uploadNodeType } from "../src/lib/canvas/canvas-file-upload";
import { registerUploadPreview, releaseUploadPreview, uploadPreviewUrl } from "../src/services/canvas-upload-preview";
import { uploadTimeoutMs } from "../src/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const video = (): CanvasNodeData => ({ id:"shot-3", title:"第三集镜头01", type:CanvasNodeType.Video, position:{x:10,y:20}, width:320,height:180, metadata:{ storageKey:"resource:original",content:"/api/resources/original/file",status:"success" } });

test("asset view preserves original and current video versions without mutating the canvas", () => {
    const original=ensureCurrentMediaVersion(video(),{source:"upload",now:"2026-10-26T00:00:00Z"});
    const latest=recordReplacedMediaVersion(original,{...original,metadata:{...original.metadata,storageKey:"resource:new",content:"/api/resources/new/file"}},"generate");
    const snapshot=JSON.stringify(latest);
    const entry=buildCanvasAssetCatalog([latest]).find(g=>g.kind==="video")!.entries[0];
    expect(entry.title).toBe("第三集镜头01");
    expect(entry.versions).toHaveLength(2);
    expect(entry.versions.filter(v=>v.primary)).toHaveLength(1);
    expect(entry.versions.every(v=>v.nodeId==="shot-3")).toBe(true);
    expect(JSON.stringify(latest)).toBe(snapshot);
});

test("incomplete uploads stay out of the asset catalog", () => {
    const pending={...video(),metadata:{...video().metadata,fileUpload:"uploading" as const}};
    expect(canvasAssetKind(pending)).toBeNull();
    expect(buildCanvasAssetCatalog([pending]).every(g=>g.entries.length===0)).toBe(true);
    expect(uploadNodeType(normalizeCanvasUploadFile(new File(["fixture"],"clip.MP4",{type:"application/octet-stream"})))).toBe(CanvasNodeType.Video);
});

test("temporary upload previews are released independently from saved media", () => {
    const node=video(),before=JSON.stringify(node);
    const first=registerUploadPreview(node.id,new Blob(["preview"]));
    expect(uploadPreviewUrl(node.id)).toBe(first);
    const replacement=registerUploadPreview(node.id,new Blob(["replacement"]));
    expect(replacement).not.toBe(first);
    releaseUploadPreview(node.id);
    expect(uploadPreviewUrl(node.id)).toBe("");
    expect(JSON.stringify(node)).toBe(before);
});

test("larger uploads receive bounded transfer time without an unbounded request", () => {
    expect(uploadTimeoutMs()).toBe(60_000);
    expect(uploadTimeoutMs(20*1024*1024)).toBeGreaterThan(uploadTimeoutMs(1024));
    expect(uploadTimeoutMs(10**12)).toBe(15*60_000);
});
