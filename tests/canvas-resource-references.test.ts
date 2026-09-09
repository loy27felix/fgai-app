import assert from "node:assert/strict";
import test from "node:test";

import { buildNodeMentionReferences, getGenerationResourceNodes, reconcileCanvasReferenceLabels } from "../reference/infinite-canvas/src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../reference/infinite-canvas/src/types/canvas";
import { dissolveGroups, expandGroupConnection, groupSelectedNodes, normalizeConnection } from "../reference/infinite-canvas/src/lib/canvas/canvas-node-geometry";
import { buildNodeGenerationContext } from "../reference/infinite-canvas/src/components/canvas/canvas-node-generation";

const position = { x: 0, y: 0 };

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position, width: 320, height: 220, metadata };
}

test("group input expands its valid children for generation", () => {
    const nodes = [
        node("group", CanvasNodeType.Group),
        node("image", CanvasNodeType.Image, { content: "https://assets.example/image.png", groupId: "group" }),
        node("text", CanvasNodeType.Text, { content: "keep the character silhouette", groupId: "group" }),
        node("config", CanvasNodeType.Config),
    ];
    const connections: CanvasConnection[] = [{ id: "group-config", fromNodeId: "group", toNodeId: "config" }];

    assert.deepEqual(
        getGenerationResourceNodes("config", nodes, connections).map((item) => item.id),
        ["image", "text"],
    );
});

test("group expansion omits empty children and keeps direct resources only once", () => {
    const nodes = [
        node("group", CanvasNodeType.Group),
        node("image", CanvasNodeType.Image, { content: "https://assets.example/image.png", groupId: "group" }),
        node("empty", CanvasNodeType.Image, { groupId: "group" }),
        node("config", CanvasNodeType.Config),
    ];
    const connections: CanvasConnection[] = [
        { id: "group-config", fromNodeId: "group", toNodeId: "config" },
        { id: "image-config", fromNodeId: "image", toNodeId: "config" },
    ];

    assert.deepEqual(
        getGenerationResourceNodes("config", nodes, connections).map((item) => item.id),
        ["image"],
    );
});

test("a generated image without upstream inputs does not present itself as a reference material", () => {
    const image = node("generated-image", CanvasNodeType.Image, { content: "https://assets.example/generated.png" });

    assert.deepEqual(buildNodeMentionReferences(image, [image], []), []);
});

test("removing the first reference preserves the labels of later prompt mentions", () => {
    const images = ["image-1", "image-2", "image-3", "image-4"].map((id) => node(id, CanvasNodeType.Image, { content: `https://assets.example/${id}.png` }));
    const config = node("config", CanvasNodeType.Config);
    const connections: CanvasConnection[] = images.map((image) => ({ id: `${image.id}-config`, fromNodeId: image.id, toNodeId: config.id }));
    const labeled = reconcileCanvasReferenceLabels([...images, config], connections);
    const labeledConfig = labeled.find((item) => item.id === config.id)!;

    assert.deepEqual(buildNodeMentionReferences(labeledConfig, labeled, connections).map((item) => item.label), ["图片1", "图片2", "图片3", "图片4"]);

    const withoutFirst = connections.filter((connection) => connection.fromNodeId !== "image-1");
    const afterRemoval = reconcileCanvasReferenceLabels(labeled, withoutFirst);
    const afterRemovalConfig = afterRemoval.find((item) => item.id === config.id)!;

    assert.deepEqual(buildNodeMentionReferences(afterRemovalConfig, afterRemoval, withoutFirst).map((item) => item.label), ["图片2", "图片3", "图片4"]);
});

test("ordinary node generation sends upstream text as explicitly numbered blocks", () => {
    const first = node("text-1", CanvasNodeType.Text, { content: "角色必须保持红色斗篷" });
    const second = node("text-2", CanvasNodeType.Text, { content: "镜头保持 16:9 横构图" });
    const config = node("config", CanvasNodeType.Config);
    const connections: CanvasConnection[] = [
        { id: "first-config", fromNodeId: first.id, toNodeId: config.id },
        { id: "second-config", fromNodeId: second.id, toNodeId: config.id },
    ];
    const labeled = reconcileCanvasReferenceLabels([first, second, config], connections);

    const context = buildNodeGenerationContext(config.id, labeled, connections, "生成一张主视觉");
    assert.equal(context.prompt, "生成一张主视觉\n\n【文本1】\n角色必须保持红色斗篷\n\n【文本2】\n镜头保持 16:9 横构图");
});

test("multi-selection can be wrapped and later dissolved without moving the selected nodes", () => {
    const first = { ...node("first", CanvasNodeType.Text), position: { x: 10, y: 20 }, width: 100, height: 80 };
    const second = { ...node("second", CanvasNodeType.Image, { content: "https://assets.example/second.png" }), position: { x: 180, y: 40 }, width: 120, height: 90 };
    const grouped = groupSelectedNodes([first, second], new Set([first.id, second.id]), "group-1");

    assert.equal(grouped.group?.type, CanvasNodeType.Group);
    assert.deepEqual(grouped.group?.position, { x: -22, y: -12 });
    assert.deepEqual(grouped.nodes.filter((item) => item.id !== "group-1").map((item) => item.metadata?.groupId), ["group-1", "group-1"]);

    const dissolved = dissolveGroups(grouped.nodes, new Set(["group-1"]));
    assert.deepEqual(dissolved.map((item) => item.id), ["first", "second"]);
    assert.deepEqual(dissolved.map((item) => item.position), [first.position, second.position]);
    assert.deepEqual(dissolved.map((item) => item.metadata?.groupId), [undefined, undefined]);
});

test("group nodes can be connected as reusable input or output containers", () => {
    const nodes = [
        node("source", CanvasNodeType.Image, { content: "https://assets.example/source.png" }),
        node("group", CanvasNodeType.Group),
        node("target", CanvasNodeType.Video),
    ];

    assert.deepEqual(normalizeConnection("group", "target", nodes, "source"), { fromNodeId: "group", toNodeId: "target" });
    assert.deepEqual(normalizeConnection("source", "group", nodes, "source"), { fromNodeId: "source", toNodeId: "group" });
});

test("connecting a reference group to a video materializes one input edge per member", () => {
    const nodes = [
        node("group", CanvasNodeType.Group),
        node("image-1", CanvasNodeType.Image, { content: "https://assets.example/image-1.png", groupId: "group" }),
        node("image-2", CanvasNodeType.Image, { content: "https://assets.example/image-2.png", groupId: "group" }),
        node("video", CanvasNodeType.Video),
    ];
    const connection = normalizeConnection("group", "video", nodes, "source");

    assert.deepEqual(connection, { fromNodeId: "group", toNodeId: "video" });
    assert.deepEqual(expandGroupConnection(connection!, nodes), [
        { fromNodeId: "image-1", toNodeId: "video" },
        { fromNodeId: "image-2", toNodeId: "video" },
    ]);
    assert.deepEqual(
        getGenerationResourceNodes("video", nodes, expandGroupConnection(connection!, nodes).map((edge, index) => ({ id: `edge-${index}`, ...edge }))).map((item) => item.id),
        ["image-1", "image-2"],
    );
});
