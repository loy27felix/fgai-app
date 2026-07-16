"use client";

import {
  ChangeEvent,
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/studio/ui";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas";
import type { VideoReferenceKind, VideoReferenceRole } from "@/lib/creator/video";

const NODE_WIDTH = 238;
const STAGE_WIDTH = 1900;
const STAGE_HEIGHT = 1160;

const NODE_ICON = {
  ref: ["M3 4h18v16H3z", "M9 9a2 2 0 1 0 0-.01", "m3 17 5-4 4 3 3-2 6 5"],
  prompt: ["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"],
  video: ["M3 5h14v14H3z", "m17 9 4-2v10l-4-2"],
  gen: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"],
} as const;
const NODE_LABEL = { ref: "参考素材", prompt: "视频提示词", video: "生视频节点", gen: "生视频节点" } as const;

export type VideoCanvasNode = CanvasNode & {
  fileKey?: string | null;
  label?: string | null;
  referenceKind?: VideoReferenceKind | null;
  role?: VideoReferenceRole | null;
};
export type CreatorVideoCanvasGraph = { nodes: VideoCanvasNode[]; edges: CanvasEdge[] };
export type VideoPreview = { file: File; url: string; kind: VideoReferenceKind; role: VideoReferenceRole };
export type CreatorVideoCanvasGenerateInput = {
  prompt: string;
  references: Array<{ key: string; role: VideoReferenceRole; kind: VideoReferenceKind }>;
  nodeId: string;
};

type Point = { x: number; y: number };
type ContextMenuState = Point & { viewX: number; viewY: number };
type Props = {
  prompt: string;
  previews: VideoPreview[];
  onPromptChange: (value: string) => void;
  onAddFiles: (files: File[]) => boolean;
  onGenerate: (input: CreatorVideoCanvasGenerateInput) => void;
  onReferenceChange?: (references: Array<{ key: string; role: VideoReferenceRole; kind: VideoReferenceKind }>) => void;
  canGenerate: boolean;
  generating?: boolean;
  initialGraph?: CreatorVideoCanvasGraph | null;
  onGraphChange?: (graph: CreatorVideoCanvasGraph) => void;
};

export function creatorVideoReferenceKey(file: File) {
  return [file.name, file.size, file.lastModified].join(":");
}

function createNodeId(kind: "ref" | "prompt" | "video") {
  return kind + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function seedGraph(previews: VideoPreview[], prompt: string): CreatorVideoCanvasGraph {
  const refs: VideoCanvasNode[] = previews.map((preview, index) => ({
    id: "seed-video-ref-" + index,
    kind: "ref",
    x: 70,
    y: 72 + index * 175,
    url: preview.url,
    fileKey: creatorVideoReferenceKey(preview.file),
    label: preview.file.name,
    referenceKind: preview.kind,
    role: preview.role,
  }));
  const promptNode: VideoCanvasNode = { id: "video-prompt-main", kind: "prompt", x: 390, y: 320, text: prompt };
  const videoNode: VideoCanvasNode = { id: "video-main", kind: "video", x: 840, y: 320, result: null };
  return {
    nodes: [...refs, promptNode, videoNode],
    edges: [...refs.map((node) => ({ from: node.id, to: videoNode.id })), { from: promptNode.id, to: videoNode.id }],
  };
}

function clampPosition(value: number, max: number) {
  return Math.max(24, Math.min(max, value));
}

function isSupportedFile(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/");
}

function kindForFile(file: File): VideoReferenceKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

function defaultRole(kind: VideoReferenceKind): VideoReferenceRole {
  if (kind === "video") return "reference_video";
  if (kind === "audio") return "reference_audio";
  return "reference_image";
}

function mediaPreview(node: VideoCanvasNode) {
  if (!node.url) return <><Icon d={NODE_ICON.ref} size={23} /><span>拖入素材，或点击选择</span></>;
  if (node.referenceKind === "video") return <video src={node.url} muted playsInline />;
  if (node.referenceKind === "audio") return <div className="creator-video-audio-preview"><Icon d={["M12 3v14", "M8 7h8", "M8 11h8", "M8 15h8"]} size={25} /><span>音频参考</span></div>;
  return <img src={node.url} alt={node.label || "参考素材"} />;
}

export default function CreatorVideoNodeCanvas({
  prompt,
  previews,
  onPromptChange,
  onAddFiles,
  onGenerate,
  onReferenceChange,
  canGenerate,
  generating = false,
  initialGraph,
  onGraphChange,
}: Props) {
  const initial = initialGraph || seedGraph(previews, prompt);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRefNodeRef = useRef<string | null>(null);
  const createdObjectUrls = useRef(new Set<string>());
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const linkRef = useRef<{ from: string } | null>(null);
  const [nodes, setNodes] = useState<VideoCanvasNode[]>(initial.nodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>("video-main");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [linkPos, setLinkPos] = useState<Point | null>(null);

  const videoNodes = useMemo(() => nodes.filter((node) => node.kind === "video"), [nodes]);
  const selectedVideo = selectedId && videoNodes.some((node) => node.id === selectedId) ? selectedId : videoNodes[0]?.id || null;
  const generationInputs = useMemo(
    () => selectedVideo
      ? edges.filter((edge) => edge.to === selectedVideo).map((edge) => nodes.find((edgeNode) => edgeNode.id === edge.from)).filter(Boolean) as VideoCanvasNode[]
      : [],
    [edges, nodes, selectedVideo],
  );
  const graphPrompt = useMemo(
    () => generationInputs.filter((node) => node.kind === "prompt").map((node) => (node.text || "").trim()).filter(Boolean).join("\n"),
    [generationInputs],
  );
  const graphReferences = useMemo(
    () => generationInputs.filter((node) => node.kind === "ref" && node.fileKey).map((node) => ({
      key: node.fileKey as string,
      kind: node.referenceKind || "image",
      role: node.role || defaultRole(node.referenceKind || "image"),
    })),
    [generationInputs],
  );

  useEffect(() => { onGraphChange?.({ nodes, edges }); }, [edges, nodes, onGraphChange]);

  useEffect(() => {
    setNodes((current) => current.map((node) => node.id === "video-prompt-main" && node.text !== prompt ? { ...node, text: prompt } : node));
  }, [prompt]);

  useEffect(() => {
    const byKey = new Map(previews.map((preview) => [creatorVideoReferenceKey(preview.file), preview]));
    setNodes((current) => current.map((node) => {
      if (node.kind !== "ref" || !node.fileKey) return node;
      const preview = byKey.get(node.fileKey);
      return preview ? { ...node, url: preview.url, label: preview.file.name, referenceKind: preview.kind, role: preview.role } : node;
    }));
  }, [previews]);

  useEffect(() => {
    if (selectedId && !nodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [nodes, selectedId]);

  useEffect(() => {
    if (!selectedVideo) return;
    if (graphPrompt !== prompt) onPromptChange(graphPrompt);
    onReferenceChange?.(graphReferences);
  }, [graphPrompt, graphReferences, onPromptChange, onReferenceChange, prompt, selectedVideo]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { setContextMenu(null); linkRef.current = null; setLinkPos(null); }
      if (event.key === "Delete" && selectedId && !contextMenu && !target?.closest("textarea,input,select,[contenteditable='true']")) deleteNode(selectedId);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); };
  });

  useEffect(() => () => {
    createdObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    createdObjectUrls.current.clear();
  }, []);

  function pointInStage(clientX: number, clientY: number) {
    const viewport = canvasRef.current;
    if (!viewport) return { x: 80, y: 80 };
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left + viewport.scrollLeft, y: clientY - rect.top + viewport.scrollTop };
  }

  function commit(nextNodes: VideoCanvasNode[], nextEdges = edges) {
    setNodes(nextNodes);
    setEdges(nextEdges);
  }

  function openContextMenu(event: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, nodeId?: string) {
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) setSelectedId(nodeId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = pointInStage(event.clientX, event.clientY);
    setContextMenu({
      x: clampPosition(point.x, STAGE_WIDTH - 285),
      y: clampPosition(point.y, STAGE_HEIGHT - 200),
      viewX: Math.max(8, Math.min(rect.width - 222, event.clientX - rect.left)),
      viewY: Math.max(8, Math.min(rect.height - 200, event.clientY - rect.top)),
    });
  }

  function addNode(kind: "ref" | "prompt" | "video", at?: Point) {
    const point = at || { x: 430, y: 250 };
    const node: VideoCanvasNode = {
      id: createNodeId(kind),
      kind,
      x: clampPosition(point.x, STAGE_WIDTH - NODE_WIDTH - 24),
      y: clampPosition(point.y, STAGE_HEIGHT - 220),
      text: kind === "prompt" ? "" : undefined,
      result: kind === "video" ? null : undefined,
      fileKey: kind === "ref" ? null : undefined,
      label: kind === "ref" ? "等待上传参考素材" : null,
      referenceKind: kind === "ref" ? "image" : null,
      role: kind === "ref" ? "reference_image" : null,
    };
    commit([...nodes, node]);
    setSelectedId(node.id);
    setContextMenu(null);
    if (kind === "ref") {
      pendingRefNodeRef.current = node.id;
      window.setTimeout(() => fileInputRef.current?.click(), 0);
    }
  }

  function quickAdd(kind: "ref" | "prompt" | "video") {
    const viewport = canvasRef.current;
    const rect = viewport?.getBoundingClientRect();
    addNode(kind, rect ? pointInStage(rect.left + rect.width * 0.48, rect.top + rect.height * 0.45) : undefined);
  }

  function deleteNode(id: string) {
    const target = nodes.find((node) => node.id === id);
    if (target?.url && createdObjectUrls.current.has(target.url)) {
      URL.revokeObjectURL(target.url);
      createdObjectUrls.current.delete(target.url);
    }
    commit(nodes.filter((node) => node.id !== id), edges.filter((edge) => edge.from !== id && edge.to !== id));
    if (selectedId === id) setSelectedId(null);
    setContextMenu(null);
  }

  function resetGraph() {
    const next = seedGraph(previews, prompt);
    commit(next.nodes, next.edges);
    setSelectedId("video-main");
    setContextMenu(null);
  }

  function updatePromptNode(id: string, value: string) {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, text: value } : node));
  }

  function attachFileToNode(id: string, file: File) {
    if (!isSupportedFile(file) || !onAddFiles([file])) return;
    const url = URL.createObjectURL(file);
    createdObjectUrls.current.add(url);
    const kind = kindForFile(file);
    const role = defaultRole(kind);
    setNodes((current) => current.map((node) => node.id === id ? { ...node, url, fileKey: creatorVideoReferenceKey(file), label: file.name, referenceKind: kind, role } : node));
    pendingRefNodeRef.current = null;
  }

  function onReferenceFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const targetId = pendingRefNodeRef.current;
    if (file && targetId) attachFileToNode(targetId, file);
    event.target.value = "";
  }

  function onNodePointerDown(event: ReactPointerEvent<HTMLElement>, id: string) {
    const target = event.target as HTMLElement;
    if (target.dataset.port || target.closest("button,textarea,input,select")) return;
    const node = nodes.find((item) => item.id === id);
    if (!node || !canvasRef.current) return;
    const point = pointInStage(event.clientX, event.clientY);
    dragRef.current = { id, dx: point.x - node.x, dy: point.y - node.y };
    setSelectedId(id);
    setContextMenu(null);
    event.stopPropagation();
  }

  function onPortDown(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    event.stopPropagation();
    linkRef.current = { from: id };
    setLinkPos(pointInStage(event.clientX, event.clientY));
  }

  function onPortUp(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    event.stopPropagation();
    const source = linkRef.current?.from;
    if (!source || source === id) { linkRef.current = null; setLinkPos(null); return; }
    const target = nodes.find((node) => node.id === id);
    if (!target || target.kind !== "video") { linkRef.current = null; setLinkPos(null); return; }
    if (!edges.some((edge) => edge.from === source && edge.to === id)) setEdges((current) => [...current, { from: source, to: id }]);
    linkRef.current = null;
    setLinkPos(null);
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (dragRef.current) {
        const point = pointInStage(event.clientX, event.clientY);
        const drag = dragRef.current;
        setNodes((current) => current.map((node) => node.id === drag.id ? {
          ...node,
          x: clampPosition(point.x - drag.dx, STAGE_WIDTH - NODE_WIDTH - 24),
          y: clampPosition(point.y - drag.dy, STAGE_HEIGHT - 220),
        } : node));
      } else if (linkRef.current) setLinkPos(pointInStage(event.clientX, event.clientY));
    };
    const onUp = () => { dragRef.current = null; linkRef.current = null; setLinkPos(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  });

  const portPoint = (node: VideoCanvasNode, side: "in" | "out") => ({ x: node.x + (side === "out" ? NODE_WIDTH : 0), y: node.y + 46 });
  const bezier = (from: Point, to: Point) => {
    const dx = Math.max(44, Math.abs(to.x - from.x) * 0.45);
    return "M " + from.x + " " + from.y + " C " + (from.x + dx) + " " + from.y + ", " + (to.x - dx) + " " + to.y + ", " + to.x + " " + to.y;
  };

  function generateFromNode(id: string) {
    const generation = nodes.find((node) => node.id === id);
    if (!generation || generation.kind !== "video") return;
    const inputs = edges.filter((edge) => edge.to === id).map((edge) => nodes.find((edgeNode) => edgeNode.id === edge.from)).filter(Boolean) as VideoCanvasNode[];
    const nextPrompt = inputs.filter((node) => node.kind === "prompt").map((node) => (node.text || "").trim()).filter(Boolean).join("\n") || prompt.trim();
    const references = inputs.filter((node) => node.kind === "ref" && node.fileKey).map((node) => ({
      key: node.fileKey as string,
      kind: node.referenceKind || "image",
      role: node.role || defaultRole(node.referenceKind || "image"),
    }));
    onGenerate({ prompt: nextPrompt, references, nodeId: id });
  }

  function addMenuNode(kind: "ref" | "prompt" | "video") {
    addNode(kind, contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined);
  }

  return (
    <section className="creator-video-node-canvas" aria-label="TapNow 风格生视频画布">
      <div className="creator-video-node-toolbar">
        <div><div className="fg-mono creator-video-node-kicker">NODE CANVAS / VIDEO</div><strong>右键添加节点，拖动端口建立输入关系</strong></div>
        <div className="creator-video-node-actions">
          <button type="button" onClick={() => quickAdd("ref")}>+ 参考素材</button>
          <button type="button" onClick={() => quickAdd("prompt")}>+ 视频提示词</button>
          <button type="button" className="primary" onClick={() => quickAdd("video")}>+ 生视频</button>
          <button type="button" className="subtle" onClick={resetGraph}>重置</button>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="creator-video-node-viewport"
        onContextMenu={(event) => openContextMenu(event)}
        onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); setContextMenu(null); }}
      >
        <div className="creator-video-node-stage" style={{ width: STAGE_WIDTH, minHeight: STAGE_HEIGHT }}>
          <svg className="creator-video-node-edges" width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true">
            {edges.map((edge, index) => {
              const from = nodes.find((node) => node.id === edge.from);
              const to = nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              return <path key={edge.from + "-" + edge.to + "-" + index} d={bezier(portPoint(from, "out"), portPoint(to, "in"))} />;
            })}
            {linkRef.current && linkPos && (() => {
              const from = nodes.find((node) => node.id === linkRef.current?.from);
              return from ? <path className="creator-video-edge-preview" d={bezier(portPoint(from, "out"), linkPos)} /> : null;
            })()}
          </svg>
          {nodes.map((node) => {
            const selected = node.id === selectedId;
            const inputCount = edges.filter((edge) => edge.to === node.id).length;
            const style: CSSProperties = {
              left: node.x,
              top: node.y,
              width: NODE_WIDTH,
              borderColor: selected ? "var(--accent)" : "var(--stroke-2)",
              boxShadow: selected ? "0 15px 42px -20px var(--accent), var(--inset)" : "var(--shadow)",
            };
            return (
              <article key={node.id} className={"creator-video-node-card creator-video-node-" + node.kind} style={style} onPointerDown={(event) => onNodePointerDown(event, node.id)} onContextMenu={(event) => openContextMenu(event, node.id)}>
                {node.kind === "video" && <div className="creator-video-port input" data-port="input" onPointerUp={(event) => onPortUp(event, node.id)} />}
                <div className="creator-video-port output" data-port="output" onPointerDown={(event) => onPortDown(event, node.id)} />
                <header className="creator-video-node-head"><span className="creator-video-node-icon"><Icon d={NODE_ICON[node.kind]} size={15} sw={1.7} /></span><span>{NODE_LABEL[node.kind]}</span><button type="button" className="creator-video-node-delete" aria-label={"删除" + NODE_LABEL[node.kind]} onClick={(event) => { event.stopPropagation(); deleteNode(node.id); }}>×</button></header>
                {node.kind === "ref" && <div className="creator-video-node-body"><div className={"creator-video-reference " + (node.url ? "has-media" : "")} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) attachFileToNode(node.id, file); }}>{mediaPreview(node)}</div><button type="button" className="creator-video-secondary" onClick={(event) => { event.stopPropagation(); pendingRefNodeRef.current = node.id; fileInputRef.current?.click(); }}>选择素材</button><div className="creator-video-caption">{node.fileKey ? (node.label || "已绑定参考素材") : "未绑定文件；连线后才会作为输入"}</div></div>}
                {node.kind === "prompt" && <div className="creator-video-node-body"><textarea value={node.text || ""} onChange={(event) => updatePromptNode(node.id, event.target.value)} onPointerDown={(event) => event.stopPropagation()} placeholder="写下镜头动作、摄影机、光线和时长…" aria-label="视频提示词节点内容" /><div className="creator-video-caption">连到生视频节点后，会合并为主 Prompt</div></div>}
                {node.kind === "video" && <div className="creator-video-node-body"><div className="creator-video-output">{node.result ? <video src={node.result} controls playsInline /> : <><Icon d={NODE_ICON.video} size={24} sw={1.5} /><span>{generating && selectedVideo === node.id ? "草稿准备中…" : "等待输入"}</span></>}</div><div className="creator-video-input-count">{inputCount} 个输入 · 连线决定参考素材和提示词</div><button type="button" className="creator-video-generate" disabled={!canGenerate || generating} onClick={(event) => { event.stopPropagation(); generateFromNode(node.id); }}>{generating && selectedVideo === node.id ? "准备中…" : "提交视频草稿"}</button></div>}
              </article>
            );
          })}
        </div>
        {contextMenu && <div ref={contextMenuRef} className="creator-video-context-menu" role="menu" style={{ left: contextMenu.viewX, top: contextMenu.viewY }} onPointerDown={(event) => event.stopPropagation()}><div className="creator-video-context-title">添加到画布</div><button type="button" role="menuitem" onClick={() => addMenuNode("ref")}><Icon d={NODE_ICON.ref} size={14} />参考素材节点</button><button type="button" role="menuitem" onClick={() => addMenuNode("prompt")}><Icon d={NODE_ICON.prompt} size={14} />视频提示词节点</button><button type="button" role="menuitem" onClick={() => addMenuNode("video")}><Icon d={NODE_ICON.video} size={14} />生视频节点</button>{selectedId && <button type="button" role="menuitem" className="danger" onClick={() => deleteNode(selectedId)}><Icon d={["M4 7h16M9 7V4h6v3M7 7l1 13h8l-1-13"]} size={14} />删除选中节点</button>}</div>}
      </div>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm" hidden onChange={onReferenceFileChange} />
      <div className="creator-video-node-footer"><span><i className="creator-video-legend-dot" />连线到「生视频节点」= 作为本次输入</span><span className="fg-mono">{graphReferences.length}/15 参考素材 · {graphPrompt.length}/30k</span></div>
      <style jsx>{`
        .creator-video-node-canvas { width:100%; min-height:650px; height:100%; display:flex; flex-direction:column; margin:0 !important; overflow:hidden; border:1px solid var(--stroke-2); border-radius:18px; background:color-mix(in srgb,var(--panel-solid) 76%,transparent); box-shadow:var(--shadow); }
        .creator-video-node-toolbar { flex:none; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:58px; padding:9px 13px 9px 16px; border-bottom:1px solid var(--stroke); background:color-mix(in srgb,var(--panel-solid) 82%,transparent); }
        .creator-video-node-kicker { color:var(--text-3); font-size:8px; letter-spacing:1.1px; }
        .creator-video-node-toolbar strong { display:block; margin-top:4px; color:var(--text-2); font-size:11.5px; font-weight:600; }
        .creator-video-node-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
        .creator-video-node-actions button { height:30px; padding:0 9px; border:1px solid var(--stroke); border-radius:8px; background:var(--panel); color:var(--text-2); cursor:pointer; font-size:10.5px; }
        .creator-video-node-actions button:hover { border-color:var(--stroke-2); color:var(--text); background:var(--panel-2); }
        .creator-video-node-actions button.primary { border-color:var(--user-stroke); background:var(--user-bubble); color:var(--accent); }
        .creator-video-node-actions button.subtle { color:var(--text-3); }
        .creator-video-node-viewport { position:relative; flex:1; min-height:0; overflow:auto; background:#09111a; scrollbar-gutter:stable; }
        .creator-video-node-stage { position:relative; background-image:linear-gradient(rgba(132,185,214,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(132,185,214,.045) 1px,transparent 1px),radial-gradient(circle at 50% 38%,rgba(116,240,142,.07),transparent 36%); background-size:32px 32px,32px 32px,auto; }
        .creator-video-node-edges { position:absolute; inset:0; z-index:1; overflow:visible; pointer-events:none; }
        .creator-video-node-edges path { fill:none; stroke:var(--accent); stroke-width:2.1; opacity:.66; filter:drop-shadow(0 0 5px rgba(116,240,142,.28)); }
        .creator-video-node-edges path.creator-video-edge-preview { stroke:var(--accent-2); stroke-dasharray:6 6; opacity:.9; }
        .creator-video-node-card { position:absolute; z-index:2; overflow:visible; border:1px solid; border-radius:13px; background:var(--panel-solid); user-select:none; cursor:grab; transition:border-color .15s ease,box-shadow .15s ease; }
        .creator-video-node-card:active { cursor:grabbing; }
        .creator-video-node-head { display:flex; align-items:center; gap:7px; height:39px; padding:0 9px; border-bottom:1px solid var(--stroke); color:var(--text-2); font-size:11.5px; font-weight:650; }
        .creator-video-node-icon { display:grid; place-items:center; color:var(--accent); }
        .creator-video-node-delete { width:22px; height:22px; display:grid; place-items:center; margin-left:auto; border:0; border-radius:6px; background:transparent; color:var(--text-3); cursor:pointer; font-size:16px; line-height:1; }
        .creator-video-node-delete:hover { color:#ff9b85; background:rgba(255,119,89,.11); }
        .creator-video-node-body { padding:9px; }
        .creator-video-port { position:absolute; top:39px; z-index:4; width:13px; height:13px; border:2px solid var(--accent); border-radius:50%; background:var(--panel-solid); box-shadow:0 0 0 3px rgba(116,240,142,.09); }
        .creator-video-port.input { left:-8px; cursor:crosshair; }
        .creator-video-port.output { right:-8px; cursor:crosshair; background:var(--accent); }
        .creator-video-reference { position:relative; display:grid; place-items:center; width:100%; aspect-ratio:1/.72; overflow:hidden; border:1px dashed var(--stroke-2); border-radius:9px; background:var(--bg-2); color:var(--text-3); text-align:center; }
        .creator-video-reference.has-media { border-style:solid; }
        .creator-video-reference img,.creator-video-reference video { display:block; width:100%; height:100%; object-fit:cover; }
        .creator-video-audio-preview { display:grid; place-items:center; gap:5px; color:var(--accent); font-size:10px; }
        .creator-video-reference span { max-width:150px; margin-top:5px; font-size:10px; line-height:1.45; }
        .creator-video-secondary,.creator-video-generate { width:100%; height:30px; margin-top:8px; border-radius:8px; cursor:pointer; font-size:10.5px; }
        .creator-video-secondary { border:1px solid var(--stroke); background:var(--panel); color:var(--text-2); }
        .creator-video-generate { border:0; background:var(--accent); color:var(--accent-ink); font-weight:700; }
        .creator-video-generate:disabled { cursor:not-allowed; opacity:.42; }
        .creator-video-caption,.creator-video-input-count { margin-top:7px; color:var(--text-3); font-size:9.5px; line-height:1.45; }
        .creator-video-node-prompt textarea { width:100%; min-height:136px; resize:vertical; padding:8px; border:1px solid var(--stroke); border-radius:8px; outline:none; background:var(--panel); color:var(--text); font:inherit; font-size:11px; line-height:1.55; }
        .creator-video-node-prompt textarea:focus { border-color:var(--stroke-2); box-shadow:0 0 0 2px rgba(116,240,142,.08); }
        .creator-video-node-prompt textarea::placeholder { color:var(--text-3); }
        .creator-video-output { display:flex; align-items:center; justify-content:center; gap:8px; min-height:112px; overflow:hidden; border:1px solid var(--stroke); border-radius:9px; background:radial-gradient(circle at 50% 30%,rgba(116,240,142,.12),transparent 65%),var(--bg-2); color:var(--text-3); font-size:10.5px; }
        .creator-video-output video { display:block; width:100%; height:100%; min-height:112px; object-fit:cover; }
        .creator-video-output svg { color:var(--accent); }
        .creator-video-context-menu { position:absolute; z-index:8; width:222px; padding:6px; border:1px solid var(--stroke-2); border-radius:12px; background:var(--panel-solid); box-shadow:0 22px 56px rgba(0,0,0,.4); }
        .creator-video-context-title { padding:6px 9px 7px; color:var(--text-3); font-family:"JetBrains Mono",monospace; font-size:9px; letter-spacing:.7px; }
        .creator-video-context-menu button { width:100%; height:34px; display:flex; align-items:center; gap:8px; padding:0 9px; border:0; border-radius:8px; background:transparent; color:var(--text-2); cursor:pointer; font-size:11.5px; text-align:left; }
        .creator-video-context-menu button:hover { background:var(--panel-2); color:var(--text); }
        .creator-video-context-menu button.danger { color:#ff9b85; }
        .creator-video-node-footer { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 13px; border-top:1px solid var(--stroke); color:var(--text-3); font-size:9.5px; }
        .creator-video-legend-dot { display:inline-block; width:6px; height:6px; margin-right:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 9px var(--accent); }
        @media (max-width:680px) { .creator-video-node-toolbar { align-items:flex-start; flex-direction:column; gap:8px; } .creator-video-node-actions { justify-content:flex-start; } .creator-video-node-footer { align-items:flex-start; flex-direction:column; } }
      `}</style>
    </section>
  );
}
