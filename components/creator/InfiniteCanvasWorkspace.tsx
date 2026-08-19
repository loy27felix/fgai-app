"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Database, Image as ImageIcon, Moon, Plus, RefreshCw, Sun, Video, X } from "lucide-react";
import FGLogo from "@/components/FGLogo";
import { nanoid } from "nanoid";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { ConnectionPath, ActiveConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { getNodeSpec } from "@/constant/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ConnectionHandle, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { createClient } from "@/lib/local/client";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";
import { VIDEO_MODELS, getVideoModel } from "@/lib/ai/video-models";
import { createImageDraft, confirmImageTask, finalizeImageUploads, listImageTasks } from "@/lib/creator/image-client";
import { createVideoDraft, confirmVideoTask, finalizeVideoUploads, getVideoTask } from "@/lib/creator/video-client";
import type { ImageReferenceManifest } from "@/lib/creator/image";
import type { VideoReferenceManifest } from "@/lib/creator/video";
import { randomId } from "@/lib/utils";

registerBuiltinNodes();
const STORE_KEY = "fg-studio:infinite-canvas:v1";
const IMAGE_MODEL = IMG_MODELS[0]?.id || "gpt-image-2";
const VIDEO_MODEL = VIDEO_MODELS[0]?.id || "doubao-seedance-2-0";

type Snapshot = { nodes: CanvasNodeData[]; connections: CanvasConnection[]; viewport: ViewportTransform; backgroundMode: CanvasBackgroundMode; title: string };
type Pending = { kind: "image" | "video"; nodeId: string; taskId: string; prompt: string; model: string; references: number };
type CreateMenu = { x: number; y: number; world: Position };
type ConnectionState = { handle: ConnectionHandle; mouseWorld: Position };
type Props = { userEmail: string; initialKind?: "image" | "video" };

type SavedCanvas = { id: string; title: string; createdAt: string; snapshot: Snapshot };

function makeNode(type: CanvasNodeType, position: Position, title?: string): CanvasNodeData {
  const spec = getNodeSpec(type);
  const metadata: CanvasNodeMetadata = { ...(spec.metadata || {}) };
  if (type === CanvasNodeType.Image) Object.assign(metadata, { model: IMAGE_MODEL, ratio: "16:9", size: sizeFor(IMAGE_MODEL, "16:9"), prompt: "", status: "idle" });
  if (type === CanvasNodeType.Video) Object.assign(metadata, { model: VIDEO_MODEL, ratio: "16:9", seconds: "5", prompt: "", status: "idle" });
  return { id: nanoid(), type, title: title || spec.title, position, width: spec.width, height: spec.height, metadata };
}
function initialSnapshot(kind: "image" | "video"): Snapshot {
  const text = makeNode(CanvasNodeType.Text, { x: 80, y: 120 }, "提示词 / 分镜");
  text.metadata = { ...text.metadata, content: kind === "video" ? "镜头从近景缓慢推向主体，保持动作因果和连续光线。" : "明确主体、构图、风格、材质与光线。" };
  const output = makeNode(kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image, { x: 520, y: 100 }, kind === "video" ? "视频输出" : "图片输出");
  const config = makeNode(CanvasNodeType.Config, { x: 80, y: 460 }, "生成配置");
  return { nodes: [text, output, config], connections: [{ id: nanoid(), fromNodeId: text.id, toNodeId: output.id }, { id: nanoid(), fromNodeId: config.id, toNodeId: output.id }], viewport: { x: 60, y: 40, k: .9 }, backgroundMode: "dots", title: kind === "video" ? "视频超级画布" : "图片超级画布" };
}
function restore(value: unknown, kind: "image" | "video"): Snapshot {
  const fallback = initialSnapshot(kind);
  if (!value || typeof value !== "object") return fallback;
  const source = value as Partial<Snapshot>;
  const nodes = Array.isArray(source.nodes) ? source.nodes.filter((item): item is CanvasNodeData => Boolean(item && typeof item === "object" && typeof (item as CanvasNodeData).id === "string")) : fallback.nodes;
  const connections = Array.isArray(source.connections) ? source.connections.filter((item): item is CanvasConnection => Boolean(item && typeof item === "object" && typeof (item as CanvasConnection).fromNodeId === "string" && typeof (item as CanvasConnection).toNodeId === "string")) : fallback.connections;
  const viewport = source.viewport && Number.isFinite(source.viewport.x) && Number.isFinite(source.viewport.y) && Number.isFinite(source.viewport.k) ? { x: source.viewport.x, y: source.viewport.y, k: Math.min(5, Math.max(.05, source.viewport.k)) } : fallback.viewport;
  const backgroundMode = source.backgroundMode === "blank" || source.backgroundMode === "lines" || source.backgroundMode === "dots" ? source.backgroundMode : fallback.backgroundMode;
  return { nodes: nodes.length ? nodes : fallback.nodes, connections, viewport, backgroundMode, title: source.title || fallback.title };
}
function toWorld(event: { clientX: number; clientY: number }, element: HTMLDivElement | null, viewport: ViewportTransform): Position {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: (event.clientX - rect.left - viewport.x) / viewport.k, y: (event.clientY - rect.top - viewport.y) / viewport.k } : { x: 0, y: 0 };
}
async function nodeFile(node: CanvasNodeData, index: number) {
  const url = node.metadata?.content;
  if (!url) return null;
  const mime = node.metadata?.mimeType || (node.type === CanvasNodeType.Video ? "video/mp4" : "image/png");
  const name = (node.title || node.type) + "-" + (index + 1) + "." + (mime.split("/")[1] || "bin");
  if (url.startsWith("data:")) {
    const parts = url.split(",", 2);
    const binary = atob(parts[1] || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type: parts[0]?.match(/^data:([^;]+)/)?.[1] || mime });
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("参考素材无法读取");
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || mime });
}
async function fileDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("素材读取失败"));
    reader.readAsDataURL(file);
  });
}

export default function InfiniteCanvasWorkspace({ userEmail, initialKind = "image" }: Props) {
  const [kind, setKind] = useState<"image" | "video">(initialKind);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initialSnapshot(initialKind));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportTransform>(() => initialSnapshot(initialKind).viewport);
  const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("dots");
  const [menu, setMenu] = useState<CreateMenu | ContextMenuState | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(356);
  const [history, setHistory] = useState<SavedCanvas[]>([]);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; positions: Record<string, Position> } | null>(null);
  const connectionRef = useRef<ConnectionState | null>(null);
  const panelResizeRef = useRef<{ x: number; width: number } | null>(null);
  const clipboardRef = useRef<CanvasNodeData[]>([]);
  const loaded = useRef(false);
  const { theme, setTheme } = useThemeStore();
  const colors = canvasThemes[theme];
  const localClient = useMemo(() => createClient(), []);
  const nodes = snapshot.nodes;
  const edges = snapshot.connections;
  const selected = nodes.find((node) => node.id === selectedIds[0]) || null;
  const output = selected && selected.type === (kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video) ? selected : nodes.find((node) => node.type === (kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video)) || null;
  const prompt = output?.metadata?.prompt || "";
  const model = output?.metadata?.model || (kind === "image" ? IMAGE_MODEL : VIDEO_MODEL);
  const ratio = output?.metadata?.ratio || "16:9";
  const duration = Number(output?.metadata?.seconds || 5);
  const inputs = useMemo(() => output ? edges.filter((edge) => edge.toNodeId === output.id).map((edge) => nodes.find((node) => node.id === edge.fromNodeId)).filter((node): node is CanvasNodeData => Boolean(node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && node.metadata?.content)) : [], [edges, nodes, output]);
  const activeStoreKey = `${STORE_KEY}:${kind}`;

  useEffect(() => {
    loaded.current = false;
    const rawHistory = window.localStorage.getItem(activeStoreKey + ":history");
    if (rawHistory) try { setHistory(JSON.parse(rawHistory) as SavedCanvas[]); } catch { setHistory([]); }
    const storedWidth = Number(window.localStorage.getItem(STORE_KEY + ":panel-width"));
    if (Number.isFinite(storedWidth) && storedWidth >= 300 && storedWidth <= 620) setPanelWidth(storedWidth);
    const raw = window.localStorage.getItem(activeStoreKey) || (kind === initialKind ? window.localStorage.getItem(STORE_KEY) : null);
    if (raw) try { const value = restore(JSON.parse(raw), kind); setSnapshot(value); setViewport(value.viewport); setBackgroundMode(value.backgroundMode); } catch { setNotice("本地画布数据无法读取，已使用新画布。"); }
    loaded.current = true;
  }, [activeStoreKey, initialKind, kind]);
  useEffect(() => { if (loaded.current) window.localStorage.setItem(activeStoreKey, JSON.stringify({ ...snapshot, viewport, backgroundMode })); }, [activeStoreKey, backgroundMode, snapshot, viewport]);
  const updateNodes = useCallback((fn: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => setSnapshot((value) => ({ ...value, nodes: fn(value.nodes) })), []);
  const updateNode = useCallback((id: string, patch: Partial<CanvasNodeData>) => updateNodes((list) => list.map((node) => node.id === id ? { ...node, ...patch, metadata: patch.metadata ? { ...node.metadata, ...patch.metadata } : node.metadata } : node)), [updateNodes]);
  const updateMeta = useCallback((id: string, patch: CanvasNodeMetadata) => updateNodes((list) => list.map((node) => node.id === id ? { ...node, metadata: { ...node.metadata, ...patch } } : node)), [updateNodes]);
  const addNode = useCallback((type: CanvasNodeType, position: Position) => { const node = makeNode(type, position); updateNodes((list) => list.concat(node)); setSelectedIds([node.id]); setMenu(null); setNotice((getNodeDefinition(type)?.title || "节点") + "已添加。"); }, [updateNodes]);
  const deleteNode = useCallback((id: string) => { setSnapshot((value) => ({ ...value, nodes: value.nodes.filter((node) => node.id !== id), connections: value.connections.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id) })); setSelectedIds((ids) => ids.filter((value) => value !== id)); setMenu(null); }, []);
  const duplicateNode = useCallback((id: string) => { const node = nodes.find((value) => value.id === id); if (!node) return; const copy = { ...node, id: nanoid(), title: node.title + " 副本", position: { x: node.position.x + 48, y: node.position.y + 48 }, metadata: { ...node.metadata } }; updateNodes((list) => list.concat(copy)); setSelectedIds([copy.id]); setMenu(null); }, [nodes, updateNodes]);

  const nodeMouseDown = useCallback((event: React.MouseEvent, id: string) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea,select,video,audio,[data-canvas-no-zoom]")) return;
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const next = additive ? (selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : selectedIds.concat(id)) : [id];
    setSelectedIds(next);
    dragRef.current = { x: event.clientX, y: event.clientY, positions: Object.fromEntries(nodes.filter((node) => next.includes(node.id)).map((node) => [node.id, node.position])) };
    const move = (moveEvent: MouseEvent) => { const drag = dragRef.current; if (!drag) return; const dx = (moveEvent.clientX - drag.x) / viewport.k; const dy = (moveEvent.clientY - drag.y) / viewport.k; updateNodes((list) => list.map((node) => drag.positions[node.id] ? { ...node, position: { x: drag.positions[node.id].x + dx, y: drag.positions[node.id].y + dy } } : node)); };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }, [nodes, selectedIds, updateNodes, viewport.k]);

  const startConnection = useCallback((event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => {
    event.preventDefault(); event.stopPropagation();
    const first = { handle: { nodeId, handleType }, mouseWorld: toWorld(event, canvasRef.current, viewport) };
    connectionRef.current = first; setConnection(first);
    const move = (moveEvent: MouseEvent) => { const next = { handle: first.handle, mouseWorld: toWorld(moveEvent, canvasRef.current, viewport) }; connectionRef.current = next; setConnection(next); };
    const up = (upEvent: MouseEvent) => {
      const current = connectionRef.current;
      if (current) {
        const point = toWorld(upEvent, canvasRef.current, viewport);
        const target = nodes.find((node) => node.id !== current.handle.nodeId && point.x >= node.position.x && point.x <= node.position.x + node.width && point.y >= node.position.y && point.y <= node.position.y + node.height);
        if (target) {
          const fromNodeId = current.handle.handleType === "source" ? current.handle.nodeId : target.id;
          const toNodeId = current.handle.handleType === "source" ? target.id : current.handle.nodeId;
          if (fromNodeId !== toNodeId) setSnapshot((value) => value.connections.some((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId) ? value : { ...value, connections: value.connections.concat({ id: nanoid(), fromNodeId, toNodeId }) });
        }
      }
      connectionRef.current = null; setConnection(null); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  }, [nodes, viewport]);

  const canvasContextMenu = useCallback((event: React.MouseEvent) => { event.preventDefault(); const target = event.target as HTMLElement; if (target.closest("[data-node-id],[data-connection-id],[data-canvas-no-zoom]")) return; setMenu({ x: event.clientX, y: event.clientY, world: toWorld(event, canvasRef.current, viewport) }); }, [viewport]);
  const setPrompt = useCallback((value: string) => { if (output) updateMeta(output.id, { prompt: value }); }, [output, updateMeta]);
  const setModel = useCallback((value: string) => { if (output) updateMeta(output.id, { model: value, size: kind === "image" ? sizeFor(value, ratio) : ratio }); }, [kind, output, ratio, updateMeta]);
  const setRatio = useCallback((value: string) => { if (output) updateMeta(output.id, { ratio: value, size: kind === "image" ? sizeFor(model, value) : value }); }, [kind, model, output, ratio, updateMeta]);
  const setDuration = useCallback((value: number) => { if (output) updateMeta(output.id, { seconds: String(value) }); }, [output, updateMeta]);
  const canvasDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (!files.length) return;
    const origin = toWorld(event, canvasRef.current, viewport);
    try {
      const added = await Promise.all(files.map(async (file, index) => {
        const type = file.type.startsWith("video/") ? CanvasNodeType.Video : CanvasNodeType.Image;
        const node = makeNode(type, { x: origin.x + index * 48, y: origin.y + index * 48 }, file.name);
        node.metadata = { ...node.metadata, content: await fileDataUrl(file), mimeType: file.type, status: "idle" };
        return node;
      }));
      updateNodes((list) => list.concat(added));
      setSelectedIds(added.map((node) => node.id));
      setNotice(`已将 ${added.length} 个素材放入画布，可连接到图片或视频输出。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "素材读取失败。"); }
  }, [updateNodes, viewport]);
  const startPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    panelResizeRef.current = { x: event.clientX, width: panelWidth };
    const move = (moveEvent: PointerEvent) => {
      const start = panelResizeRef.current;
      if (!start) return;
      setPanelWidth(Math.min(620, Math.max(300, start.width + start.x - moveEvent.clientX)));
    };
    const up = (upEvent: PointerEvent) => {
      const start = panelResizeRef.current;
      if (start) window.localStorage.setItem(STORE_KEY + ":panel-width", String(Math.min(620, Math.max(300, start.width + start.x - upEvent.clientX))));
      panelResizeRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [panelWidth]);
  const openHistory = useCallback((item: SavedCanvas) => {
    const value = restore(item.snapshot, kind);
    setSnapshot(value); setViewport(value.viewport); setBackgroundMode(value.backgroundMode); setSelectedIds([]); setNotice(`已打开历史画布：${item.title}`);
  }, [kind]);
  const removeHistory = useCallback((id: string) => {
    setHistory((items) => {
      const next = items.filter((item) => item.id !== id);
      window.localStorage.setItem(activeStoreKey + ":history", JSON.stringify(next));
      return next;
    });
  }, [activeStoreKey]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable=true]")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "c" && selectedIds.length) {
        clipboardRef.current = nodes.filter((node) => selectedIds.includes(node.id)).map((node) => ({ ...node, position: { ...node.position }, metadata: { ...node.metadata } }));
        setNotice(`${clipboardRef.current.length} 个节点已复制。`);
        event.preventDefault();
      } else if (modifier && event.key.toLowerCase() === "v" && clipboardRef.current.length) {
        const copies = clipboardRef.current.map((node) => ({ ...node, id: nanoid(), position: { x: node.position.x + 56, y: node.position.y + 56 }, metadata: { ...node.metadata } }));
        setSnapshot((value) => ({ ...value, nodes: value.nodes.concat(copies) }));
        setSelectedIds(copies.map((node) => node.id));
        setNotice(`${copies.length} 个节点已粘贴。`);
        event.preventDefault();
      } else if (!modifier && (event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        setSnapshot((value) => ({ ...value, nodes: value.nodes.filter((node) => !selectedIds.includes(node.id)), connections: value.connections.filter((edge) => !selectedIds.includes(edge.fromNodeId) && !selectedIds.includes(edge.toNodeId)) }));
        setSelectedIds([]); setMenu(null); setNotice("已删除选中节点。"); event.preventDefault();
      } else if (event.key === "Escape") {
        setMenu(null); setConnection(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodes, selectedIds]);
  const prepare = useCallback(async () => {
    if (!output || (output.type !== CanvasNodeType.Image && output.type !== CanvasNodeType.Video)) { setError("请先选择图片或视频输出节点。"); return; }
    const text = prompt.trim() || nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.content)?.metadata?.content?.trim() || "";
    if (!text && !inputs.length) { setError("请填写 Prompt，或连接有内容的参考节点。"); return; }
    setBusy(true); setError(""); setNotice("正在创建草稿并上传参考素材，暂不会调用模型。");
    try {
      const files: File[] = [];
      for (let index = 0; index < inputs.length; index += 1) { const file = await nodeFile(inputs[index], index); if (file) files.push(file); }
      if (output.type === CanvasNodeType.Image) {
        const references: ImageReferenceManifest[] = files.map((file) => ({ name: file.name, mimeType: file.type, size: file.size }));
        const draft = await createImageDraft({ canvasId: null, nodeId: output.id, prompt: text, model, ratio, references, skill: null, idempotencyKey: randomId() });
        for (let index = 0; index < files.length; index += 1) { const upload = await localClient.storage.from("creator-assets").upload(draft.uploadPaths[index], files[index], { upsert: false, contentType: files[index].type }); if (upload.error) throw upload.error; }
        await finalizeImageUploads(draft.task.id, draft.uploadPaths);
        setPending({ kind: "image", nodeId: output.id, taskId: draft.task.id, prompt: text, model, references: files.length });
      } else {
        const references: VideoReferenceManifest[] = files.map((file) => ({ name: file.name, mimeType: file.type, size: file.size, kind: file.type.startsWith("video/") ? "video" : "image", role: file.type.startsWith("video/") ? "reference_video" : "reference_image" } as VideoReferenceManifest));
        const spec = getVideoModel(model);
        const draft = await createVideoDraft({ canvasId: null, nodeId: output.id, prompt: text, model, references, duration: Math.max(4, Math.min(15, Number.isFinite(duration) ? duration : 5)), ratio, resolution: spec?.resolutions?.[0] || "720p", watermark: false, generateAudio: false, skill: null, idempotencyKey: randomId() });
        for (let index = 0; index < files.length; index += 1) { const upload = await localClient.storage.from("creator-assets").upload(draft.uploadPaths[index], files[index], { upsert: false, contentType: files[index].type }); if (upload.error) throw upload.error; }
        await finalizeVideoUploads(draft.task.id, draft.uploadPaths);
        setPending({ kind: "video", nodeId: output.id, taskId: draft.task.id, prompt: text, model, references: files.length });
      }
      setNotice("草稿已准备好。确认弹窗中的按钮才会正式调用模型。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "草稿准备失败。"); } finally { setBusy(false); }
  }, [duration, inputs, kind, model, nodes, output, prompt, ratio, localClient]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const current = pending; setPending(null); setBusy(true); updateMeta(current.nodeId, { status: "loading", prompt: current.prompt, model: current.model });
    try {
      if (current.kind === "image") {
        const result = await confirmImageTask(current.taskId);
        if (result.resultUrl) updateMeta(current.nodeId, { content: result.resultUrl, mimeType: "image/png", status: "success" });
        else for (let attempt = 0; attempt < 40; attempt += 1) { const list = await listImageTasks(); const task = list.tasks.find((item) => item.id === current.taskId); if (task?.resultUrl) { updateMeta(current.nodeId, { content: task.resultUrl, mimeType: "image/png", status: "success" }); break; } if (task?.status === "failed" || task?.status === "expired") throw new Error("图片生成失败，请查看历史任务。"); await new Promise((resolve) => setTimeout(resolve, 3000)); }
      } else {
        const result = await confirmVideoTask(current.taskId);
        if (result.videoUrl) updateMeta(current.nodeId, { content: result.videoUrl, mimeType: "video/mp4", status: "success" });
        else for (let attempt = 0; attempt < 40; attempt += 1) { const task = (await getVideoTask(current.taskId)).task; if (task.videoUrl) { updateMeta(current.nodeId, { content: task.videoUrl, mimeType: "video/mp4", status: "success" }); break; } if (task.status === "failed" || task.status === "expired") throw new Error("视频生成失败，请查看历史任务。"); await new Promise((resolve) => setTimeout(resolve, 3000)); }
      }
      setNotice("生成结果已回写到画布。");
    } catch (cause) { updateMeta(current.nodeId, { status: "error", errorDetails: cause instanceof Error ? cause.message : "生成失败" }); setError(cause instanceof Error ? cause.message : "生成失败。"); } finally { setBusy(false); }
  }, [pending, updateMeta]);

  const resetCanvas = useCallback(() => {
    const archived: SavedCanvas = { id: nanoid(), title: snapshot.title, createdAt: new Date().toISOString(), snapshot: { ...snapshot, nodes: snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, metadata: { ...node.metadata } })), connections: snapshot.connections.map((edge) => ({ ...edge })), viewport: { ...snapshot.viewport } } };
    setHistory((items) => {
      const next = [archived, ...items].slice(0, 12);
      window.localStorage.setItem(activeStoreKey + ":history", JSON.stringify(next));
      return next;
    });
    const value = initialSnapshot(kind);
    setSnapshot(value); setViewport(value.viewport); setBackgroundMode(value.backgroundMode); setSelectedIds([]); setNotice("已新开画布，旧画布已归档到左侧历史。");
  }, [activeStoreKey, kind, snapshot]);  const outputOptions = nodes.filter((node) => node.type === (kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video));

  return (
    <div className="fg-infinite-canvas" data-theme={theme}>
      <header className="fg-infinite-header"><div className="fg-infinite-brand"><a href="/workspace" title="返回工作区"><FGLogo size={34} /></a><span><strong>超级画布</strong><small>SUPER CANVAS · PRIVATE</small></span></div><div className="fg-infinite-title"><span>画布工作台</span><strong>{snapshot.title}</strong></div><div className="fg-infinite-actions"><a className="fg-infinite-back" href="/workspace">← 工作区</a><button type="button" className={kind === "image" ? "active" : ""} onClick={() => setKind("image")}><ImageIcon size={15} />图片</button><button type="button" className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}><Video size={15} />视频</button><button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button><span className="fg-infinite-user">{userEmail.slice(0, 2).toUpperCase() || "FG"}</span></div></header>
      <div className="fg-infinite-body" style={{ "--fg-panel-width": `${panelWidth}px` } as CSSProperties}>
        <aside className="fg-infinite-left"><a href="/creator" className="fg-infinite-back">← 返回对话</a><button type="button" className="fg-infinite-new" onClick={resetCanvas}><Plus size={15} />新开画布</button><div className="fg-infinite-left-label">画布工具</div><button type="button" onClick={() => addNode(CanvasNodeType.Text, { x: 120, y: 120 })}><Plus size={14} />文本节点</button><button type="button" onClick={() => addNode(CanvasNodeType.Image, { x: 180, y: 280 })}><ImageIcon size={14} />图片节点</button><button type="button" onClick={() => addNode(CanvasNodeType.Video, { x: 560, y: 280 })}><Video size={14} />视频节点</button><button type="button" onClick={() => addNode(CanvasNodeType.Config, { x: 120, y: 480 })}><Database size={14} />生成配置</button><div className="fg-infinite-left-label">历史画布 <span className="fg-history-count">{history.length}</span></div><div className="fg-history-list">{history.length ? history.slice(0, 8).map((item) => <div className="fg-history-item" key={item.id}><button type="button" className="fg-history-open" onClick={() => openHistory(item)}><span>{item.title}</span><small>{new Date(item.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></button><button type="button" className="fg-history-delete" onClick={() => removeHistory(item.id)} aria-label={`删除${item.title}`}>×</button></div>) : <div className="fg-history-empty">新开画布后会保留最近 12 个快照</div>}</div><div className="fg-infinite-hint">右键画布添加节点<br />拖动节点端口建立参考关系<br />拖入图片 / 视频即可成为参考节点<br />选中输出节点后在右侧生成</div><div className="fg-infinite-left-footer">草稿 → 明确确认 → 模型调用。<br />浏览器不会保存 Wetoken key。</div></aside>
        <main className="fg-infinite-stage">{notice ? <div className="fg-infinite-toast">{notice}</div> : null}{error ? <div className="fg-infinite-error">{error}<button type="button" onClick={() => setError("")}><X size={13} /></button></div> : null}
          <InfiniteCanvas containerRef={canvasRef} viewport={viewport} backgroundMode={backgroundMode} onViewportChange={setViewport} onContextMenu={canvasContextMenu} onCanvasDeselect={() => setSelectedIds([])} onDrop={canvasDrop}><svg className="fg-infinite-connections" width="1" height="1" viewBox="0 0 1 1" aria-hidden="true">{edges.map((edge) => { const from = nodes.find((node) => node.id === edge.fromNodeId); const to = nodes.find((node) => node.id === edge.toNodeId); return from && to ? <ConnectionPath key={edge.id} connection={edge} from={from} to={to} active={selectedIds.includes(from.id) || selectedIds.includes(to.id)} onSelect={() => setSelectedIds([to.id])} onContextMenu={(event) => { event.preventDefault(); setMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: edge.id }); }} /> : null; })}{connection ? <ActiveConnectionPath node={nodes.find((node) => node.id === connection.handle.nodeId)} handle={connection.handle} mouseWorld={connection.mouseWorld} /> : null}</svg>{nodes.map((node) => <CanvasNode key={node.id} data={node} scale={viewport.k} isSelected={selectedIds.includes(node.id)} isRelated={Boolean(hoveredId && edges.some((edge) => (edge.fromNodeId === hoveredId && edge.toNodeId === node.id) || (edge.toNodeId === hoveredId && edge.fromNodeId === node.id)))} isFocusRelated={false} isConnectionTarget={Boolean(connection && connection.handle.nodeId !== node.id)} isConnecting={Boolean(connection)} showPanel={false} showImageInfo onMouseDown={nodeMouseDown} onSelectCapture={(_, id) => setSelectedIds((current) => current.includes(id) ? current : [id])} onHoverStart={setHoveredId} onHoverEnd={() => setHoveredId(null)} onConnectStart={startConnection} onResize={(id, width, height, position) => updateNode(id, { width, height, ...(position ? { position } : {}) })} onContentChange={(id, value) => updateMeta(id, { content: value })} onTitleChange={(id, value) => updateNode(id, { title: value })} onViewImage={(item) => { if (item.metadata?.content) window.open(item.metadata.content, "_blank", "noopener,noreferrer"); }} onContextMenu={(event, id) => { event.preventDefault(); event.stopPropagation(); setMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id }); }} renderNodeContent={(item) => item.type === CanvasNodeType.Config ? <div className="fg-config-node"><strong>生成配置</strong><span>{item.metadata?.generationMode === "video" ? "视频" : "图片"} · 连接到输出节点</span></div> : undefined} />)}</InfiniteCanvas>
          <CanvasZoomControls scale={viewport.k} onScaleChange={(scale) => setViewport((value) => ({ ...value, k: scale }))} onReset={() => setViewport({ x: 60, y: 40, k: .9 })} isMiniMapOpen={minimapOpen} onToggleMiniMap={() => setMinimapOpen((value) => !value)} />{minimapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={{ width: canvasRef.current?.clientWidth || 800, height: canvasRef.current?.clientHeight || 600 }} onViewportChange={setViewport} /> : null}
          {menu && "world" in menu ? <div className="fg-infinite-create-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}><strong>添加节点</strong><button type="button" onClick={() => addNode(CanvasNodeType.Text, menu.world)}><Plus size={14} />文本</button><button type="button" onClick={() => addNode(CanvasNodeType.Image, menu.world)}><ImageIcon size={14} />图片</button><button type="button" onClick={() => addNode(CanvasNodeType.Video, menu.world)}><Video size={14} />视频</button><button type="button" onClick={() => addNode(CanvasNodeType.Config, menu.world)}><Database size={14} />生成配置</button></div> : null}{menu && "nodeId" in menu ? <CanvasNodeContextMenu menu={menu} onClose={() => setMenu(null)} onDuplicate={() => duplicateNode(menu.nodeId)} onDelete={() => deleteNode(menu.nodeId)} /> : null}{menu && "connectionId" in menu ? <CanvasNodeContextMenu menu={menu} onClose={() => setMenu(null)} onDuplicate={() => undefined} onDelete={() => { setSnapshot((value) => ({ ...value, connections: value.connections.filter((edge) => edge.id !== menu.connectionId) })); setMenu(null); }} /> : null}
        </main>
        <aside className="fg-infinite-inspector"><div className="fg-panel-resizer" onPointerDown={startPanelResize} title="拖动调整参数栏宽度" /><div className="fg-infinite-inspector-head"><div><small>CONTROL SURFACE</small><h2>{kind === "image" ? "图片生成" : "视频生成"}</h2></div><span>{output?.metadata?.status || "idle"}</span></div><div className="fg-infinite-inspector-scroll"><label className="fg-field">输出节点<select value={output?.id || ""} onChange={(event) => setSelectedIds(event.target.value ? [event.target.value] : [])}><option value="">选择图片 / 视频节点</option>{outputOptions.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>{output ? <><label className="fg-field">模型<select value={model} onChange={(event) => setModel(event.target.value)}>{(kind === "image" ? IMG_MODELS : VIDEO_MODELS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="fg-field">画幅<select value={ratio} onChange={(event) => setRatio(event.target.value)}>{(kind === "image" ? RATIOS.map((item) => item.key) : ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{kind === "video" ? <label className="fg-field">时长 <span className="fg-range-value">{duration}s</span><input type="range" min="4" max="15" step="1" value={Math.max(4, Math.min(15, Number.isFinite(duration) ? duration : 5))} onChange={(event) => setDuration(Number(event.target.value))} /></label> : null}<label className="fg-field">Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === "image" ? "描述主体、构图、风格、材质与光线…" : "描述镜头动作、摄影机、节奏与环境…"} /></label><div className="fg-reference-count">已连接参考素材：{inputs.length} 个</div><button type="button" className="fg-generate" onClick={() => void prepare()} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} />{busy ? "准备中…" : "准备草稿"}</button><div className="fg-safe-note">草稿不会调用模型；确认弹窗中的按钮才会产生费用。</div>{output.metadata?.content ? <a className="fg-open-result" href={output.metadata.content} target="_blank" rel="noreferrer">打开当前结果 ↗</a> : null}</> : <div className="fg-empty-inspector">右键画布添加节点，或从左侧新建输出节点。</div>}</div><div className="fg-inspector-footer"><span>{theme === "dark" ? "深色画布" : "浅色画布"}</span><select value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value as CanvasBackgroundMode)}><option value="dots">点阵</option><option value="lines">网格</option><option value="blank">空白</option></select><button type="button" onClick={() => setMinimapOpen((value) => !value)}><Copy size={14} /></button></div></aside>
      </div>
      {pending ? <div className="fg-confirm-backdrop"><div className="fg-confirm"><div className="fg-confirm-icon">{pending.kind === "image" ? <ImageIcon size={20} /> : <Video size={20} />}</div><h2>确认调用模型？</h2><p>模型：{pending.model}<br />参考素材：{pending.references} 个<br />确认后会正式调用并计入费用账本。</p><div className="fg-confirm-actions"><button type="button" onClick={() => setPending(null)}>取消</button><button type="button" className="primary" onClick={() => void confirm()}><Check size={15} />确认生成</button></div></div></div> : null}
    </div>
  );
}
