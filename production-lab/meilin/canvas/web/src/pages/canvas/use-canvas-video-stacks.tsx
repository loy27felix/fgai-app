import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App, Button, Modal } from "antd";
import { applyVideoStackPrimary, isVideoStack, stackCanvasVideos, unstackCanvasVideos, videoStackConnections, videoStackDropTarget, videoStackMembers } from "@/lib/canvas/canvas-video-stack";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type Options = {
    projectId: string;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    selectedNodeIds: Set<string>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
};
export function useCanvasVideoStacks({ projectId, nodes, nodesRef, connectionsRef, selectedNodeIds, setNodes, setConnections, setSelectedNodeIds, setDialogNodeId }: Options) {
    const { message } = App.useApp();
    const primaryByRoot = useRef(new Map<string, string | undefined>());
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [viewedId, setViewedId] = useState<string | null>(null);
    const [wide, setWide] = useState(false);
    useEffect(() => {
        setPreviewId(null);
        setViewedId(null);
    }, [projectId]);
    const commit = useCallback(
        (next: { nodes: CanvasNodeData[]; connections: CanvasConnection[] }) => {
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            setNodes(next.nodes);
            setConnections(next.connections);
        },
        [nodesRef, connectionsRef, setNodes, setConnections],
    );
    useEffect(() => {
        let edges = connectionsRef.current;
        let changed = false;
        const current = new Map<string, string | undefined>();
        for (const root of nodes.filter(isVideoStack)) {
            const primary = root.metadata?.primaryImageId;
            current.set(root.id, primary);
            if (primary && primaryByRoot.current.has(root.id) && primaryByRoot.current.get(root.id) !== primary) {
                edges = videoStackConnections(root, primary, edges, nodes);
                changed = true;
            }
        }
        primaryByRoot.current = current;
        if (changed) setConnections(edges);
    }, [nodes, connectionsRef, setConnections]);
    const tryStackOnDrop = useCallback(
        (nodeId: string) => {
            if (selectedNodeIds.size > 1) return false;
            const source = nodesRef.current.find((node) => node.id === nodeId);
            const target = source && videoStackDropTarget(source, nodesRef.current);
            if (!source || !target) return false;
            const stacked = stackCanvasVideos(source.id, target.id, nodesRef.current, connectionsRef.current);
            if (!stacked) return false;
            commit(stacked);
            setSelectedNodeIds(new Set([stacked.rootId]));
            setDialogNodeId(stacked.rootId);
            message.success("视频已叠放，点击右上角数量可预览和选择主视频");
            return true;
        },
        [selectedNodeIds, nodesRef, connectionsRef, commit, setSelectedNodeIds, setDialogNodeId, message],
    );
    const open = useCallback(
        (nodeId: string) => {
            const root = nodesRef.current.find((node) => node.id === nodeId);
            if (!isVideoStack(root)) return false;
            setPreviewId(nodeId);
            setViewedId(root!.metadata?.primaryImageId || null);
            return true;
        },
        [nodesRef],
    );
    const root = nodes.find((node) => node.id === previewId);
    const members = root ? videoStackMembers(root, nodes) : [];
    const viewed = members.find((node) => node.id === viewedId) || members[0];
    const index = members.findIndex((node) => node.id === viewed?.id);
    const selectPrimary = () => {
        const liveRoot = nodesRef.current.find((node) => node.id === previewId);
        const member = nodesRef.current.find((node) => node.id === viewed?.id);
        if (!liveRoot || !member) return;
        const updated = applyVideoStackPrimary(liveRoot, member);
        commit({ nodes: nodesRef.current.map((node) => (node.id === updated.id ? updated : node)), connections: videoStackConnections(updated, member.id, connectionsRef.current, nodesRef.current) });
        setDialogNodeId(updated.id);
        message.success("主视频、提示词、生成参数和参考连线已一起切换");
    };
    const split = () => {
        const liveRoot = nodesRef.current.find((node) => node.id === previewId);
        if (!liveRoot) return;
        commit(unstackCanvasVideos(liveRoot, nodesRef.current, connectionsRef.current));
        setSelectedNodeIds(new Set(members.map((node) => node.id)));
        setDialogNodeId(null);
        setPreviewId(null);
        message.success("已展开为独立视频节点，原结果和参考关系保留");
    };
    const resourceId = resourceIdFromStorageKey(viewed?.metadata?.storageKey);
    const url = resourceId ? resourceFileUrl(resourceId) : viewed?.metadata?.content;
    const modal = (
        <Modal
            open={Boolean(root && viewed)}
            title={`视频版本 · ${index + 1} / ${members.length}`}
            width={wide ? "calc(100vw - 32px)" : 920}
            centered
            destroyOnHidden
            onCancel={() => setPreviewId(null)}
            footer={
                <div className="flex flex-wrap justify-between gap-2">
                    <Button onClick={split}>展开为独立节点</Button>
                    <div className="flex gap-2">
                        <Button onClick={() => setWide((value) => !value)}>{wide ? "缩小预览" : "放大预览"}</Button>
                        <Button type="primary" disabled={viewed?.id === root?.metadata?.primaryImageId} onClick={selectPrimary}>
                            {viewed?.id === root?.metadata?.primaryImageId ? "当前主视频" : "设为主视频"}
                        </Button>
                    </div>
                </div>
            }
        >
            {viewed && (
                <div className="grid gap-3">
                    <video key={viewed.id} src={url} controls autoPlay playsInline preload="metadata" className="w-full rounded-lg bg-black object-contain" style={{ maxHeight: wide ? "72dvh" : "55dvh" }} />
                    <div className="flex items-center gap-2">
                        <Button disabled={index <= 0} onClick={() => setViewedId(members[index - 1].id)}>
                            上一段
                        </Button>
                        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                            {members.map((member, i) => (
                                <Button key={member.id} type={member.id === viewed.id ? "primary" : "default"} onClick={() => setViewedId(member.id)}>
                                    {String(i + 1).padStart(2, "0")}
                                    {member.id === root?.metadata?.primaryImageId ? " · 主视频" : ""}
                                </Button>
                            ))}
                        </div>
                        <Button disabled={index >= members.length - 1} onClick={() => setViewedId(members[index + 1].id)}>
                            下一段
                        </Button>
                    </div>
                    <div className="text-xs text-foreground/60">
                        {viewed.title} · {viewed.metadata?.vquality || "原始清晰度"} · {viewed.metadata?.seconds || Number(viewed.metadata?.durationMs) / 1000 || "未知"} 秒 · {viewed.metadata?.model || "导入视频"}
                    </div>
                    <details>
                        <summary className="cursor-pointer text-sm">查看这段视频生成时的提示词</summary>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{viewed.metadata?.videoGenerationRecipe?.prompt || viewed.metadata?.prompt || "导入的视频没有生成提示词"}</pre>
                    </details>
                </div>
            )}
        </Modal>
    );
    return { tryStackOnDrop, openVideoStack: open, videoStackModal: modal };
}
