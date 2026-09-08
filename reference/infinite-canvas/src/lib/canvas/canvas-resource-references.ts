import { imageReferenceLabel } from "@/reference/infinite-canvas/src/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/reference/infinite-canvas/src/lib/seedance-video";
import { getNodeDefinition } from "@/reference/infinite-canvas/src/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/reference/infinite-canvas/src/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true, node.metadata?.referenceLabels);
}

/**
 * Allocate labels once per prompt target and keep them in node metadata.
 * Removed resource IDs stay in the map as tombstones so their old number is
 * never reassigned to a later image in the same prompt.
 */
export function reconcileCanvasReferenceLabels(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return nodes.map((node) => {
        const references = labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true, node.metadata?.referenceLabels);
        if (!references.length) return node;
        const current = node.metadata?.referenceLabels || {};
        const next = { ...current };
        let changed = false;
        references.forEach((reference) => {
            if (next[reference.nodeId] === reference.label) return;
            next[reference.nodeId] = reference.label;
            changed = true;
        });
        return changed ? { ...node, metadata: { ...node.metadata, referenceLabels: next } } : node;
    });
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const directInputs = connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node));

    return expandGroupResourceNodes(directInputs, nodes);
}

/**
 * A group is a visual/container node, not a provider resource itself. When it
 * is connected to a config or generator, use every valid child as input so one
 * edge represents the whole reference pack. Recursion also keeps nested groups
 * safe, while the id set prevents a direct child edge from being duplicated.
 */
function expandGroupResourceNodes(inputs: CanvasNodeData[], allNodes: CanvasNodeData[]) {
    const resolved: CanvasNodeData[] = [];
    const visited = new Set<string>();

    const add = (node: CanvasNodeData) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);

        if (node.type === CanvasNodeType.Group) {
            allNodes.filter((candidate) => candidate.metadata?.groupId === node.id).forEach(add);
            return;
        }

        if (isResourceNode(node)) resolved.push(node);
    };

    inputs.forEach(add);
    return resolved;
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

export function labelResourceNodes(nodes: CanvasNodeData[], active: boolean, persistedLabels: Record<string, string> = {}) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    Object.values(persistedLabels).forEach((label) => {
        const parsed = parseLabel(label);
        if (parsed) counts[parsed.kind] = Math.max(counts[parsed.kind], parsed.index + 1);
    });
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = getCanvasResourceKind(node);
        if (!kind) return [];
        const label = persistedLabels[node.id] || labelForKind(kind, counts[kind]++);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function parseLabel(label: string): { kind: CanvasResourceKind; index: number } | null {
    const match = /^(图片|视频|音频|文本)(\d+)$/.exec(label);
    if (!match) return null;
    const kind = match[1] === "图片" ? "image" : match[1] === "视频" ? "video" : match[1] === "音频" ? "audio" : "text";
    const index = Number(match[2]) - 1;
    return Number.isInteger(index) && index >= 0 ? { kind, index } : null;
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(getCanvasResourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

/** Returns the input kind a canvas node can contribute to a prompt. */
export function getCanvasResourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // 插件节点通过 definition.resource 声明可作为输入
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
