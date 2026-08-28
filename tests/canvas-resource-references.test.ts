import assert from "node:assert/strict";
import test from "node:test";

import { getGenerationResourceNodes } from "../reference/infinite-canvas/src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../reference/infinite-canvas/src/types/canvas";

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
