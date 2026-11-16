import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { executeVideoGeneration } from "@/pages/canvas/canvas-media-generation-executors";
import type { CanvasGenerationExecution } from "@/pages/canvas/canvas-generation-executor-types";
import { assertVideoCapability } from "@/services/api/video-validation";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

for (const mime of ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav", " Audio/WAVE; codecs=1 ", "audio/mpeg", "audio/x-mpeg"]) {
    test(`WAV/MP3 reference MIME alias ${mime} is accepted`, () => {
        const profile = defaultModelCapabilityConfig("seedance", "seedance-2.5").video!;
        profile.references.audioFormats = ["wav", "mp3"];
        profile.references.maxAudios = 3;
        expect(() => assertVideoCapability(profile, [], [], [{ id: "voice", name: "角色声音", type: mime, url: "https://media.example/voice.wav" }], "5")).not.toThrow();
    });
}
test("unsupported reference formats identify the audio and supported formats", () => {
    const profile = defaultModelCapabilityConfig("seedance", "seedance-2.5").video!;
    profile.references.audioFormats = ["wav", "mp3"];
    profile.references.maxAudios = 3;
    expect(() => assertVideoCapability(profile, [], [], [{ id: "voice", name: "角色声音", type: "audio/mp4", url: "https://media.example/voice.m4a" }], "5")).toThrow("第 1 个参考音频");
});
test("an in-place video resubmission failure stops loading and keeps the previous video", async () => {
    const source: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "镜头", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "https://media.example/previous.mp4", storageKey: "resource:previous", generationResultPlacement: "replace-node", status: "success" } };
    let nodes = [source];
    const finished: string[] = [];
    const execution: CanvasGenerationExecution = {
        projectId: "canvas", nodeId: source.id, sourceNode: source, canvasNodes: nodes, canvasConnections: [], prompt: "镜头", effectivePrompt: "镜头", generationConfig: { ...defaultConfig, model: "seedance-2.5", videoModel: "seedance-2.5" },
        generationContext: { prompt: "镜头", referenceImages: [], referenceVideos: [], referenceAudios: [], referenceImageSlots: [], characterReferences: [], resolvedCharacterVersions: [], resolvedCharacterVoices: [], textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 },
        controller: new AbortController(), editingTextNode: false, styleMetadata: {}, skillMetadata: {},
        setNodes: value => { nodes = typeof value === "function" ? value(nodes) : value; }, setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {}, startGenerationRequest: () => new AbortController(), finishGenerationRequest: id => { finished.push(id); }, bindGenerationTask: () => {}, applyGenerationTaskResult: async () => {}, showError: () => {}, registerPendingNodeIds: () => {},
    };
    await expect(executeVideoGeneration(execution, async () => { throw new Error("第 1 个参考音频格式不支持"); })).rejects.toThrow("参考音频");
    expect(nodes[0].metadata?.status).toBe("error");
    expect(nodes[0].metadata?.taskCompletedAt).toBeTruthy();
    expect(nodes[0].metadata?.errorDetails).toContain("参考音频");
    expect(nodes[0].metadata?.content).toBe(source.metadata?.content);
    expect(finished).toEqual([source.id]);
});
