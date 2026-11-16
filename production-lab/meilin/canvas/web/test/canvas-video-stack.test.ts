import { expect, test } from "bun:test";
import { applyVideoStackPrimary, captureVideoGenerationRecipe, isVideoStack, stackCanvasVideos, unstackCanvasVideos, videoStackConnections, videoStackDropTarget, videoStackMembers } from "../src/lib/canvas/canvas-video-stack";
import { applyBatchPrimaryImage, isHiddenBatchChild, removeCanvasNodes } from "../src/lib/canvas/canvas-project-domain";
import { buildCanvasConnectionIndex } from "../src/lib/canvas/canvas-connection-index";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
const video = (id: string, x = 0): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Video,
    title: id,
    position: { x, y: 0 },
    width: 320,
    height: 180,
    metadata: {
        content: `${id}.mp4`,
        storageKey: `resource:${id}`,
        videoPreview: { content: `${id}-poster.jpg`, storageKey: `resource:${id}-poster` },
        prompt: `${id}-submitted-prompt`,
        composerContent: `${id}-editor-prompt`,
        model: `${id}-model`,
        seconds: "12",
        vquality: "480p",
        status: "success",
        taskId: `${id}-task`,
        references: [`${id}-reference`],
    },
});
const a = video("a"),
    b = video("b", 20);
const ra = { ...video("ra", -500), type: CanvasNodeType.Image },
    rb = { ...ra, id: "rb", position: { x: -500, y: 250 } };
const nodes = [a, b, ra, rb];
const edges: CanvasConnection[] = [
    { id: "ref-a", fromNodeId: "ra", toNodeId: "a" },
    { id: "ref-b", fromNodeId: "rb", toNodeId: "b" },
];

test("drag stacking requires deliberate central overlap, ready results and the same frame", () => {
    expect(videoStackDropTarget(b, nodes)?.id).toBe("a");
    expect(videoStackDropTarget({ ...b, position: { x: 300, y: 0 } }, nodes)).toBeUndefined();
    expect(videoStackDropTarget({ ...b, metadata: { ...b.metadata, taskStatus: "running" } }, nodes)).toBeUndefined();
    expect(stackCanvasVideos("b", "a", [a, { ...b, parentId: "another-frame" }], edges)).toBeUndefined();
});
test("stacking keeps original video IDs, tasks, resources and reference edges", () => {
    const stacked = stackCanvasVideos("b", "a", nodes, edges)!;
    const root = stacked.nodes.find((node) => node.id === stacked.rootId)!;
    expect(isVideoStack(root)).toBe(true);
    expect(root.metadata?.taskId).toBeUndefined();
    expect(videoStackMembers(root, stacked.nodes).map((node) => node.id)).toEqual(["a", "b"]);
    for (const original of [a, b]) {
        const member = stacked.nodes.find((node) => node.id === original.id)!;
        expect(member.metadata?.taskId).toBe(original.metadata?.taskId);
        expect(member.metadata?.storageKey).toBe(original.metadata?.storageKey);
        expect(isHiddenBatchChild(member, stacked.nodes)).toBe(true);
    }
    expect(stacked.connections).toContainEqual(edges[0]);
    expect(stacked.connections).toContainEqual(edges[1]);
});
test("changing the primary switches the complete prompt, model, media and visible input edges", () => {
    const stacked = stackCanvasVideos("b", "a", nodes, edges)!;
    const root = stacked.nodes.find((node) => node.id === stacked.rootId)!;
    const primary = applyVideoStackPrimary(
        root,
        stacked.nodes.find((node) => node.id === "b")!,
    );
    expect(primary.metadata?.content).toBe("b.mp4");
    expect(primary.metadata?.videoPreview).toEqual(b.metadata?.videoPreview);
    expect(primary.metadata?.prompt).toBe("b-submitted-prompt");
    expect(primary.metadata?.composerContent).toBe("b-editor-prompt");
    expect(primary.metadata?.model).toBe("b-model");
    expect(primary.metadata?.references).toEqual(["b-reference"]);
    expect(primary.metadata?.taskId).toBeUndefined();
    const updatedNodes = stacked.nodes.map((node) => (node.id === root.id ? primary : node));
    const updatedEdges = videoStackConnections(primary, "b", stacked.connections, updatedNodes);
    const visible = [...buildCanvasConnectionIndex(updatedNodes, updatedEdges).entriesById.values()];
    expect(visible.map((entry) => [entry.fromId, entry.toId])).toEqual([["rb", root.id]]);
});
test("deleting the primary chooses the survivor and switches its prompt as well", () => {
    const stacked = stackCanvasVideos("b", "a", nodes, edges)!;
    const removed = removeCanvasNodes(stacked.nodes, new Set(["a"]));
    const root = removed.nodes.find((node) => node.id === stacked.rootId)!;
    expect(root.metadata?.primaryImageId).toBe("b");
    expect(root.metadata?.prompt).toBe("b-submitted-prompt");
    expect(applyBatchPrimaryImage(root, b).metadata?.model).toBe("b-model");
});
test("unstacking preserves originals and connections without accumulating proxy jobs", () => {
    const stacked = stackCanvasVideos("b", "a", nodes, edges)!;
    const root = stacked.nodes.find((node) => node.id === stacked.rootId)!;
    const restored = unstackCanvasVideos(root, stacked.nodes, stacked.connections);
    expect(restored.nodes.map((node) => node.id).sort()).toEqual(nodes.map((node) => node.id).sort());
    expect(restored.connections).toEqual(edges);
    expect(restored.nodes.find((node) => node.id === "a")?.metadata?.taskId).toBe("a-task");
    expect(restored.nodes.every((node) => !node.metadata?.batchRootId)).toBe(true);
});
test("two stacks merge without duplicating original results", () => {
    const first = stackCanvasVideos("b", "a", nodes, edges)!;
    const second = stackCanvasVideos("d", "c", [...first.nodes, video("c", 800), video("d", 820)], first.connections)!;
    const joined = stackCanvasVideos(second.rootId, first.rootId, second.nodes, second.connections)!;
    const root = joined.nodes.find((node) => node.id === joined.rootId)!;
    expect(videoStackMembers(root, joined.nodes).map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(joined.nodes.filter(isVideoStack)).toHaveLength(1);
});

test("generation snapshots keep the original prompt and references after later draft edits", () => {
    const captured = captureVideoGenerationRecipe(a, edges);
    const edited = { ...captured, metadata: { ...captured.metadata, prompt: "new draft", composerContent: "new draft editor", model: "different-model" } };
    const stacked = stackCanvasVideos("b", "a", [edited, b, ra, rb], edges)!;
    const root = stacked.nodes.find((node) => node.id === stacked.rootId)!;
    expect(root.metadata?.prompt).toBe("a-submitted-prompt");
    expect(root.metadata?.composerContent).toBe("a-editor-prompt");
    expect(root.metadata?.model).toBe("a-model");
    const changed = edges.map((edge) => (edge.toNodeId === "a" ? { ...edge, fromNodeId: "rb" } : edge));
    expect(
        videoStackConnections(root, "a", changed, stacked.nodes)
            .filter((edge) => edge.toNodeId === root.id)
            .map((edge) => edge.fromNodeId),
    ).toEqual(["ra"]);
});

test("missing reference nodes are not recreated as dangling live connections", () => {
    const stacked = stackCanvasVideos("b", "a", nodes, edges)!;
    const root = stacked.nodes.find((node) => node.id === stacked.rootId)!;
    const remaining = stacked.nodes.filter((node) => node.id !== "ra");
    expect(videoStackConnections(root, "a", stacked.connections, remaining).filter((edge) => edge.toNodeId === root.id)).toHaveLength(0);
    expect(root.metadata?.videoGenerationReferenceConnections).toHaveLength(1);
});
