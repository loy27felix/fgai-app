import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

type Options = {
    nodesRef: {current: CanvasNodeData[]}; connectionsRef: {current: CanvasConnection[]};
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>; setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    getCanvasCenter: () => {x: number; y: number};
    saveCanvasProject: (options?: {requireRemote?: boolean}) => Promise<boolean>;
};
export function useDirectorDesk({nodesRef, connectionsRef, setNodes, setConnections, getCanvasCenter, saveCanvasProject}: Options) {
    const [open, setOpen] = useState(false);
    const [nodeId, setNodeId] = useState<string>();
    const sceneId = useRef<string | undefined>(undefined);
    const lastDocument = useRef("");
    const openDesk = useCallback((node?: CanvasNodeData) => {
        sceneId.current = node?.metadata?.directorDesk ? node.id : undefined;
        setNodeId(sceneId.current); lastDocument.current = ""; setOpen(true);
    }, []);
    const commit = useCallback(async (node: CanvasNodeData, linkFrom?: string) => {
        const previousNodes = nodesRef.current; const previousLinks = connectionsRef.current;
        const exists = previousNodes.some(n => n.id === node.id);
        setNodes(exists ? previousNodes.map(n => n.id === node.id ? node : n) : [...previousNodes, node]);
        if (linkFrom) setConnections([...previousLinks, {id: nanoid(), fromNodeId: linkFrom, toNodeId: node.id}]);
        try { if (!await saveCanvasProject({requireRemote: true})) throw new Error("画布未保存到服务器，请重试"); }
        catch (error) {
            // Roll back only this write, retaining unrelated edits made while upload/save was in flight.
            setNodes(current => current.filter(n => n.id !== node.id).concat(previousNodes.filter(n => n.id === node.id)));
            if (linkFrom) setConnections(current => current.filter(c => c.toNodeId !== node.id || c.fromNodeId !== linkFrom));
            throw error;
        }
    }, [nodesRef, connectionsRef, saveCanvasProject, setNodes, setConnections]);
    const saveDocument = useCallback(async (document: Record<string, unknown>) => {
        const content = JSON.stringify(document);
        if (lastDocument.current === content) return;
        const uploaded = await uploadMediaFile(new File([content], `${String(document.name || "3D工程")}.director.json`, {type: "application/json"}), "director-scene");
        if (uploaded.pendingRemoteUpload) throw new Error("3D 工程尚未保存到 NAS");
        const existing = nodesRef.current.find(n => n.id === sceneId.current);
        const node: CanvasNodeData = {id: sceneId.current || nanoid(), type: CanvasNodeType.Text, position: existing?.position || getCanvasCenter(), width: existing?.width || 320, height: existing?.height || 180,
            title: `3D 导演台 · ${String(document.name || "新工程")}`, metadata: {...existing?.metadata, directorDesk: true, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType,
                content: `${String(document.name || "3D工程")}\n${Array.isArray(document.scenes) ? document.scenes.length : 1} 个戏段 · 工程已保存到 NAS\n从节点上方打开，可继续搭场景、排走位和设计运镜。`, status: "success"}};
        await commit(node); sceneId.current = node.id; setNodeId(node.id); lastDocument.current = content;
    }, [nodesRef, getCanvasCenter, commit]);
    const saveOutput = useCallback(async (file: File) => {
        const parent = nodesRef.current.find(n => n.id === sceneId.current);
        const position = parent ? {x: parent.position.x + parent.width + 80, y: parent.position.y + nodesRef.current.filter(n => n.metadata?.directorDeskSourceId === parent.id).length * 230} : getCanvasCenter();
        let node: CanvasNodeData;
        if (file.type.startsWith("image/")) {
            const image = await uploadImage(file); if (image.pendingRemoteUpload) throw new Error("截图尚未保存到 NAS");
            node = {id: nanoid(), type: CanvasNodeType.Image, title: file.name, position, ...fitNodeSize(image.width, image.height, 360, 240), metadata: imageMetadata(image)};
        } else if (file.type.startsWith("video/")) {
            const video = await uploadMediaFile(file, "director-video"); if (video.pendingRemoteUpload) throw new Error("视频尚未保存到 NAS");
            node = {id: nanoid(), type: CanvasNodeType.Video, title: file.name, position, ...fitNodeSize(video.width || 1280, video.height || 720, 360, 240), metadata: videoMetadata(video)};
        } else if (file.type.startsWith("text/")) {
            node = {id: nanoid(), type: CanvasNodeType.Text, title: file.name, position, width: 360, height: 240, metadata: {content: await file.text(), status: "success"}};
        } else {
            const upload = await uploadMediaFile(file, "director-export"); if (upload.pendingRemoteUpload) throw new Error("文件尚未保存到 NAS");
            node = {id: nanoid(), type: CanvasNodeType.Text, title: file.name, position, width: 320, height: 180, metadata: {content: `导演台导出：${file.name}`, storageKey: upload.storageKey, bytes: upload.bytes, mimeType: upload.mimeType, status: "success"}};
        }
        node.metadata = {...node.metadata, directorDeskSourceId: parent?.id}; await commit(node, parent?.id);
    }, [nodesRef, getCanvasCenter, commit]);
    return {open, openDesk, closeDesk: () => setOpen(false), node: nodesRef.current.find(n => n.id === nodeId), saveDocument, saveOutput};
}
