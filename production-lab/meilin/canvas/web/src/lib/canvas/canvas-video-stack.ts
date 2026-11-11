import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function isVideoStack(node?: CanvasNodeData) {
    return node?.type === CanvasNodeType.Video && node.metadata?.mediaStackKind === "video";
}
export function videoStackMembers(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    return (root.metadata?.batchChildIds || []).map((id) => nodes.find((node) => node.id === id)).filter((node): node is CanvasNodeData => Boolean(node?.type === CanvasNodeType.Video && node.metadata?.batchRootId === root.id));
}
function ready(node: CanvasNodeData) {
    return (
        node.type === CanvasNodeType.Video &&
        Boolean(node.metadata?.content || node.metadata?.storageKey) &&
        !node.metadata?.locked &&
        !["queued", "running"].includes(node.metadata?.taskStatus || "") &&
        !["loading", "queued", "running"].includes(node.metadata?.status || "")
    );
}
export function videoStackDropTarget(source: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (!ready(source) || source.metadata?.batchRootId) return undefined;
    const center = { x: source.position.x + source.width / 2, y: source.position.y + source.height / 2 };
    return [...nodes].reverse().find((target) => {
        if (target.id === source.id || !ready(target) || target.metadata?.batchRootId || target.parentId !== source.parentId) return false;
        const insetX = target.width * 0.18,
            insetY = target.height * 0.18;
        return center.x > target.position.x + insetX && center.x < target.position.x + target.width - insetX && center.y > target.position.y + insetY && center.y < target.position.y + target.height - insetY;
    });
}
export function applyVideoStackPrimary(root: CanvasNodeData, primary: CanvasNodeData): CanvasNodeData {
    if (!ready(primary) || !root.metadata?.batchChildIds?.includes(primary.id)) return root;
    // The stack is a view of the selected original. It never owns that original's job.
    const metadata = { ...primary.metadata, ...primary.metadata?.videoGenerationRecipe };
    for (const key of Object.keys(metadata)) if (/^task|^lastGeneration|^generationBatches|^version/.test(key)) delete metadata[key as keyof typeof metadata];
    return {
        ...root,
        title: primary.title,
        width: primary.width,
        height: primary.height,
        metadata: { ...metadata, batchRootId: undefined, isBatchRoot: true, mediaStackKind: "video", batchChildIds: root.metadata.batchChildIds, primaryImageId: primary.id, imageBatchExpanded: false, generationResultPlacement: "new-version" },
    };
}
export function videoStackConnections(root: CanvasNodeData, primaryId: string, connections: CanvasConnection[], nodes: CanvasNodeData[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const members = new Set(root.metadata?.batchChildIds || []);
    const originalInputs = root.metadata?.videoGenerationReferenceConnections || connections.filter((edge) => edge.toNodeId === primaryId);
    return [
        ...connections.filter((edge) => edge.toNodeId !== root.id),
        ...originalInputs.filter((edge) => nodeIds.has(edge.fromNodeId) && !members.has(edge.fromNodeId) && edge.fromNodeId !== root.id).map((edge) => ({ ...edge, id: nanoid(), toNodeId: root.id })),
    ];
}
export function stackCanvasVideos(sourceId: string, targetId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const source = nodes.find((node) => node.id === sourceId),
        target = nodes.find((node) => node.id === targetId);
    if (!source || !target || source.id === target.id || !ready(source) || !ready(target) || source.parentId !== target.parentId || source.metadata?.batchRootId || target.metadata?.batchRootId) return undefined;
    const members = [...(isVideoStack(target) ? videoStackMembers(target, nodes) : [target]), ...(isVideoStack(source) ? videoStackMembers(source, nodes) : [source])].map((node) => captureVideoGenerationRecipe(node, connections));
    if (members.some((node) => !ready(node))) return undefined;
    const ids = [...new Set(members.map((node) => node.id))];
    const rootId = isVideoStack(target) ? target.id : nanoid();
    const primary = members.find((node) => node.id === (target.metadata?.primaryImageId || target.id)) || members[0];
    const root = applyVideoStackPrimary({ ...target, id: rootId, metadata: { ...target.metadata, batchChildIds: ids } }, primary);
    const retiredRoots = new Set([...(isVideoStack(source) ? [source.id] : []), ...(isVideoStack(target) ? [target.id] : [])]);
    const nextNodes = nodes
        .filter((node) => !retiredRoots.has(node.id))
        .map((node) => {
            const captured = members.find((member) => member.id === node.id);
            return captured ? { ...captured, metadata: { ...captured.metadata, batchRootId: rootId } } : node;
        });
    // Keep every original ID, file, task and reference connection. Only proxy connections change.
    const nextConnections = connections.filter((edge) => !retiredRoots.has(edge.toNodeId)).map((edge) => (retiredRoots.has(edge.fromNodeId) ? { ...edge, fromNodeId: rootId } : edge));
    return { rootId, nodes: [...nextNodes, root], connections: videoStackConnections(root, primary.id, nextConnections, [...nextNodes, root]) };
}
export function unstackCanvasVideos(root: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const primaryId = root.metadata?.primaryImageId;
    const members = videoStackMembers(root, nodes);
    const nextNodes = nodes
        .filter((node) => node.id !== root.id)
        .map((node) => {
            const index = members.findIndex((member) => member.id === node.id);
            if (index < 0) return node;
            return { ...node, position: { x: root.position.x + index * (root.width + 40), y: root.position.y }, metadata: { ...node.metadata, batchRootId: undefined } };
        });
    return {
        nodes: nextNodes,
        connections: connections
            .filter((edge) => edge.toNodeId !== root.id)
            .map((edge) => (edge.fromNodeId === root.id && primaryId ? { ...edge, fromNodeId: primaryId } : edge))
            .filter((edge) => edge.fromNodeId !== root.id),
    };
}

export function captureVideoGenerationRecipe(node: CanvasNodeData, connections: CanvasConnection[]): CanvasNodeData {
    if (node.metadata?.videoGenerationRecipe) return node;
    const recipe = { ...node.metadata };
    for (const key of Object.keys(recipe)) if (/^task|^status|^error|^resourceReload|^generationError|^failedPrompt/.test(key)) delete recipe[key as keyof typeof recipe];
    delete recipe.videoGenerationRecipe;
    delete recipe.content;
    delete recipe.storageKey;
    delete recipe.assetId;
    return { ...node, metadata: { ...node.metadata, videoGenerationRecipe: recipe, videoGenerationReferenceConnections: connections.filter((edge) => edge.toNodeId === node.id).map((edge) => ({ ...edge })) } };
}
