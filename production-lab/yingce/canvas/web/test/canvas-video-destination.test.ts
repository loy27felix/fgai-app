import { expect, test } from "bun:test";
import { executeVideoGeneration } from "../src/pages/canvas/canvas-media-generation-executors";
import type { CanvasGenerationExecution } from "../src/pages/canvas/canvas-generation-executor-types";
import { defaultConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../src/types/canvas";

test.each([false, true])("video generation always creates a fresh result, including legacy replace-node settings (existing media: %s)", async (existing) => {
    const source: CanvasNodeData = {
        id: "source",
        type: CanvasNodeType.Video,
        title: "Original",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: existing ? "original.mp4" : undefined, model: "original-model", prompt: "original-prompt", generationResultPlacement: "replace-node", copiedFromNodeId: "old-video", status: existing ? "success" : "idle" },
    };
    const reference: CanvasNodeData = { ...source, id: "reference", type: CanvasNodeType.Image, position: { x: -400, y: 0 }, metadata: { content: "image.png" } };
    let nodes = [source, reference];
    let connections: CanvasConnection[] = [{ id: "original-edge", fromNodeId: "reference", toNodeId: "source" }];
    let targets: string[] = [];
    let submitted = 0;
    const execution = {
        nodeId: source.id,
        sourceNode: source,
        canvasNodes: nodes,
        canvasConnections: connections,
        prompt: "new editor prompt",
        effectivePrompt: "new submitted prompt",
        projectId: "qa-canvas",
        generationConfig: { ...defaultConfig, model: "seedance-test", size: "16:9", vquality: "480p", videoSeconds: "12" },
        generationContext: { referenceImages: [], referenceVideos: [], referenceAudios: [], resolvedCharacterVersions: [], resolvedCharacterVoices: [] },
        controller: new AbortController(),
        styleMetadata: {},
        skillMetadata: {},
        setNodes: (update: (previous: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodes = update(nodes);
        },
        setConnections: (update: (previous: CanvasConnection[]) => CanvasConnection[]) => {
            connections = update(connections);
        },
        setSelectedNodeIds: () => {},
        setDialogNodeId: () => {},
        startGenerationRequest: () => {},
        finishGenerationRequest: () => {},
        registerPendingNodeIds: (ids: string[]) => {
            targets = ids;
        },
    } as unknown as CanvasGenerationExecution;
    await executeVideoGeneration(execution, async () => {
        submitted++;
    });
    expect(submitted).toBe(1);
    expect(nodes).toHaveLength(3);
    const output = nodes.find((node) => node.id === targets[0])!;
    expect(output.id).not.toBe(source.id);
    expect(output.metadata?.videoGenerationRecipe?.prompt).toBe("new submitted prompt");
    expect(output.metadata?.composerContent).toBe("new editor prompt");
    expect(output.metadata?.model).toBe("seedance-test");
    expect(nodes.find((node) => node.id === source.id)?.metadata?.prompt).toBe("original-prompt");
    expect(nodes.find((node) => node.id === source.id)?.metadata?.content).toBe(source.metadata?.content);
    expect(connections).toContainEqual({ id: "original-edge", fromNodeId: "reference", toNodeId: "source" });
    expect(connections.some((edge) => edge.fromNodeId === "reference" && edge.toNodeId === output.id)).toBe(true);
    expect(connections.some((edge) => edge.fromNodeId === "source" && edge.toNodeId === output.id)).toBe(false);
});
