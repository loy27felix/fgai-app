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
import {
  MAX_CREATOR_IMAGE_FILE_BYTES,
  MAX_CREATOR_IMAGE_REFERENCES,
  MAX_CREATOR_IMAGE_TOTAL_BYTES,
} from "@/lib/creator/image";
import type { CanvasEdge, CanvasKind, CanvasNode } from "@/lib/canvas";

const NODE_WIDTH = 224;
const STAGE_WIDTH = 1800;
const STAGE_HEIGHT = 1100;

const NODE_ICON: Record<CanvasKind, string[]> = {
  ref: ["M3 4h18v16H3z", "M9 9a2 2 0 1 0 0-.01", "m3 17 5-4 4 3 3-2 6 5"],
  prompt: ["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"],
  gen: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"],
  video: ["M3 5h18v14H3z", "m10 9 5 3-5 3z"],
};

const NODE_LABEL: Record<CanvasKind, string> = {
  ref: "参考图",
  prompt: "提示词",
  gen: "生图节点",
  video: "视频节点",
};

export type ImageCanvasNode = CanvasNode & {
  fileKey?: string | null;
  label?: string | null;
};

export type CreatorImageCanvasGraph = { nodes: ImageCanvasNode[]; edges: CanvasEdge[] };

type Preview = { file: File; url: string };
type Point = { x: number; y: number };
type ContextMenuState = Point & { viewX: number; viewY: number };

export type CreatorImageCanvasGenerateInput = {
  prompt: string;
  referenceKeys: string[];
  nodeId: string;
};

type Props = {
  prompt: string;
  previews: Preview[];
  onPromptChange: (value: string) => void;
  onAddFiles: (files: File[]) => boolean;
  onGenerate: (input: CreatorImageCanvasGenerateInput) => void;
  onReferenceKeysChange?: (keys: string[]) => void;
  canGenerate: boolean;
  generating?: boolean;
  initialGraph?: CreatorImageCanvasGraph | null;
  onGraphChange?: (graph: CreatorImageCanvasGraph) => void;
};

export function creatorImageReferenceKey(file: File) {
  return [file.name, file.size, file.lastModified].join(":");
}

function createNodeId(kind: CanvasKind) {
  return kind + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function seedGraph(previews: Preview[], prompt: string) {
  const refs: ImageCanvasNode[] = previews.map((preview, index) => ({
    id: "seed-ref-" + index,
    kind: "ref",
    x: 76,
    y: 78 + index * 164,
    url: preview.url,
    fileKey: creatorImageReferenceKey(preview.file),
    label: preview.file.name,
  }));
  const promptNode: ImageCanvasNode = {
    id: "prompt-main",
    kind: "prompt",
    x: 400,
    y: 258,
    text: prompt,
  };
  const genNode: ImageCanvasNode = {
    id: "gen-main",
    kind: "gen",
    x: 820,
    y: 258,
    result: null,
  };
  return {
    nodes: [...refs, promptNode, genNode],
    edges: [
      ...refs.map((node) => ({ from: node.id, to: genNode.id })),
      { from: promptNode.id, to: genNode.id },
    ] as CanvasEdge[],
  };
}

function clampPosition(value: number, max: number) {
  return Math.max(24, Math.min(max, value));
}

function isReferenceFile(file: File) {
  return (
    file.type === "image/jpeg"
    || file.type === "image/png"
    || file.type === "image/webp"
  ) && file.size > 0
    && file.size <= MAX_CREATOR_IMAGE_FILE_BYTES;
}

export default function CreatorImageNodeCanvas({
  prompt,
  previews,
  onPromptChange,
  onAddFiles,
  onGenerate,
  onReferenceKeysChange,
  canGenerate,
  generating = false,
  initialGraph,
  onGraphChange,
}: Props) {
  const initial = initialGraph ? initialGraph : seedGraph(previews, prompt);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRefNodeRef = useRef<string | null>(null);
  const createdObjectUrls = useRef(new Set<string>());
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const linkRef = useRef<{ from: string } | null>(null);
  const [nodes, setNodes] = useState<ImageCanvasNode[]>(initial.nodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>("gen-main");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [linkPos, setLinkPos] = useState<Point | null>(null);

  const generationNodes = useMemo(
    () => nodes.filter((node) => node.kind === "gen"),
    [nodes],
  );
  const selectedGeneration = selectedId && generationNodes.some((node) => node.id === selectedId)
    ? selectedId
    : generationNodes[0]?.id || null;
  const generationInputs = useMemo(
    () => selectedGeneration
      ? edges
        .filter((edge) => edge.to === selectedGeneration)
        .map((edge) => nodes.find((node) => node.id === edge.from))
        .filter(Boolean) as ImageCanvasNode[]
      : [],
    [edges, nodes, selectedGeneration],
  );
  const graphPrompt = useMemo(
    () => generationInputs
      .filter((node) => node.kind === "prompt")
      .map((node) => (node.text || "").trim())
      .filter(Boolean)
      .join("\n"),
    [generationInputs],
  );
  const graphReferenceKeys = useMemo(
    () => generationInputs
      .filter((node) => node.kind === "ref" && node.fileKey)
      .map((node) => node.fileKey as string),
    [generationInputs],
  );

  useEffect(() => {
    onGraphChange?.({ nodes, edges });
  }, [nodes, edges]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.id !== "prompt-main" || node.text === prompt) return node;
        changed = true;
        return { ...node, text: prompt };
      });
      return changed ? next : current;
    });
  }, [prompt]);

  useEffect(() => {
    setNodes((current) => {
      const byKey = new Map(previews.map((preview) => [creatorImageReferenceKey(preview.file), preview]));
      const seen = new Set<string>();
      let changed = false;
      const next = current.map((node) => {
        if (node.kind !== "ref" || !node.fileKey) return node;
        const preview = byKey.get(node.fileKey);
        if (!preview) return node;
        seen.add(node.fileKey);
        if (node.url === preview.url && node.label === preview.file.name) return node;
        changed = true;
        return { ...node, url: preview.url, label: preview.file.name };
      });
      for (const preview of previews) {
        const key = creatorImageReferenceKey(preview.file);
        if (seen.has(key) || next.some((node) => node.kind === "ref" && node.fileKey === key)) continue;
        changed = true;
        next.push({
          id: createNodeId("ref"),
          kind: "ref",
          x: 76,
          y: 78 + next.filter((node) => node.kind === "ref").length * 164,
          url: preview.url,
          fileKey: key,
          label: preview.file.name,
        });
      }
      return changed ? next : current;
    });
  }, [previews]);

  useEffect(() => {
    if (selectedId && !nodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [nodes, selectedId]);

  useEffect(() => {
    if (!selectedGeneration) return;
    if (graphPrompt !== prompt) onPromptChange(graphPrompt);
    onReferenceKeysChange?.(graphReferenceKeys);
  }, [
    graphPrompt,
    graphReferenceKeys,
    nodes,
    onPromptChange,
    onReferenceKeysChange,
    prompt,
    selectedGeneration,
  ]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        linkRef.current = null;
        setLinkPos(null);
      }
      const target = event.target as HTMLElement | null;
      if (event.key === "Delete" && selectedId && !contextMenu && !target?.closest("textarea,input,[contenteditable=\"true\"]")) deleteNode(selectedId);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  });

  useEffect(() => () => {
    createdObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    createdObjectUrls.current.clear();
  }, []);

  function pointInStage(clientX: number, clientY: number) {
    const viewport = canvasRef.current;
    if (!viewport) return { x: 80, y: 80 };
    const rect = viewport.getBoundingClientRect();
    return {
      x: clientX - rect.left + viewport.scrollLeft,
      y: clientY - rect.top + viewport.scrollTop,
    };
  }

  function commit(nextNodes: ImageCanvasNode[], nextEdges = edges) {
    setNodes(nextNodes);
    setEdges(nextEdges);
  }

  function openContextMenu(event: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, nodeId?: string) {
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) setSelectedId(nodeId);
    const viewport = canvasRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const stagePoint = pointInStage(event.clientX, event.clientY);
    setContextMenu({
      x: clampPosition(stagePoint.x, STAGE_WIDTH - 260),
      y: clampPosition(stagePoint.y, STAGE_HEIGHT - 180),
      viewX: Math.max(8, Math.min(rect.width - 218, event.clientX - rect.left)),
      viewY: Math.max(8, Math.min(rect.height - 192, event.clientY - rect.top)),
    });
  }

  function addNode(kind: CanvasKind, at?: Point) {
    const point = at || { x: 420, y: 240 };
    const node: ImageCanvasNode = {
      id: createNodeId(kind),
      kind,
      x: clampPosition(point.x, STAGE_WIDTH - NODE_WIDTH - 24),
      y: clampPosition(point.y, STAGE_HEIGHT - 210),
      text: kind === "prompt" ? "" : undefined,
      result: kind === "gen" ? null : undefined,
      fileKey: kind === "ref" ? null : undefined,
      label: kind === "ref" ? "等待上传参考图" : null,
    };
    commit([...nodes, node]);
    setSelectedId(node.id);
    setContextMenu(null);
    if (kind === "ref") {
      pendingRefNodeRef.current = node.id;
      window.setTimeout(() => fileInputRef.current?.click(), 0);
    }
  }

  function quickAdd(kind: CanvasKind) {
    const viewport = canvasRef.current;
    const rect = viewport?.getBoundingClientRect();
    const point = rect ? pointInStage(rect.left + rect.width * 0.48, rect.top + rect.height * 0.45) : { x: 420, y: 240 };
    addNode(kind, point);
  }

  function deleteNode(id: string) {
    const target = nodes.find((node) => node.id === id);
    if (target?.url && createdObjectUrls.current.has(target.url)) {
      URL.revokeObjectURL(target.url);
      createdObjectUrls.current.delete(target.url);
    }
    commit(
      nodes.filter((node) => node.id !== id),
      edges.filter((edge) => edge.from !== id && edge.to !== id),
    );
    if (selectedId === id) setSelectedId(null);
    setContextMenu(null);
  }

  function resetGraph() {
    const next = seedGraph(previews, prompt);
    commit(next.nodes, next.edges);
    setSelectedId("gen-main");
    setContextMenu(null);
  }

  function updatePromptNode(id: string, value: string) {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, text: value } : node));
  }

  function attachFileToNode(id: string, file: File) {
    if (!isReferenceFile(file)) return;
    if (file.size > MAX_CREATOR_IMAGE_TOTAL_BYTES) return;
    if (!onAddFiles([file])) return;
    const url = URL.createObjectURL(file);
    createdObjectUrls.current.add(url);
    setNodes((current) => current.map((node) => {
      if (node.id !== id) return node;
      if (node.url && createdObjectUrls.current.has(node.url)) {
        URL.revokeObjectURL(node.url);
        createdObjectUrls.current.delete(node.url);
      }
      return { ...node, url, fileKey: creatorImageReferenceKey(file), label: file.name };
    }));
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
    if (target.dataset.port || target.closest("button,textarea,input")) return;
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
    if (!source || source === id) {
      linkRef.current = null;
      setLinkPos(null);
      return;
    }
    const target = nodes.find((node) => node.id === id);
    if (!target || target.kind !== "gen") {
      linkRef.current = null;
      setLinkPos(null);
      return;
    }
    if (!edges.some((edge) => edge.from === source && edge.to === id)) {
      setEdges((current) => [...current, { from: source, to: id }]);
    }
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
          y: clampPosition(point.y - drag.dy, STAGE_HEIGHT - 210),
        } : node));
      } else if (linkRef.current) {
        setLinkPos(pointInStage(event.clientX, event.clientY));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      linkRef.current = null;
      setLinkPos(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  const portPoint = (node: ImageCanvasNode, side: "in" | "out") => ({
    x: node.x + (side === "out" ? NODE_WIDTH : 0),
    y: node.y + 46,
  });
  const bezier = (from: Point, to: Point) => {
    const dx = Math.max(44, Math.abs(to.x - from.x) * 0.45);
    return "M " + from.x + " " + from.y + " C " + (from.x + dx) + " " + from.y + ", " + (to.x - dx) + " " + to.y + ", " + to.x + " " + to.y;
  };

  function generateFromNode(id: string) {
    const generation = nodes.find((node) => node.id === id);
    if (!generation || generation.kind !== "gen") return;
    const inputs = edges
      .filter((edge) => edge.to === id)
      .map((edge) => nodes.find((node) => node.id === edge.from))
      .filter(Boolean) as ImageCanvasNode[];
    const nextPrompt = inputs
      .filter((node) => node.kind === "prompt")
      .map((node) => (node.text || "").trim())
      .filter(Boolean)
      .join("\n") || prompt.trim();
    const refs = inputs
      .filter((node) => node.kind === "ref" && node.fileKey)
      .map((node) => node.fileKey as string);
    onGenerate({ prompt: nextPrompt, referenceKeys: refs, nodeId: id });
  }

  function addMenuNode(kind: CanvasKind) {
    addNode(kind, contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined);
  }

  return (
    <section className="creator-image-node-canvas" aria-label="TapNow 风格生图画布">
      <div className="creator-node-toolbar">
        <div>
          <div className="fg-mono creator-node-kicker">NODE CANVAS / IMAGE</div>
          <strong>右键添加节点，拖动端口建立输入关系</strong>
        </div>
        <div className="creator-node-toolbar-actions">
          <button type="button" onClick={() => quickAdd("ref")}>+ 参考图</button>
          <button type="button" onClick={() => quickAdd("prompt")}>+ 提示词</button>
          <button type="button" className="primary" onClick={() => quickAdd("gen")}>+ 生图</button>
          <button type="button" className="subtle" onClick={resetGraph} title="重置当前画布">重置</button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="creator-node-viewport"
        onContextMenu={(event) => openContextMenu(event)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSelectedId(null);
          setContextMenu(null);
        }}
      >
        <div className="creator-node-stage" style={{ width: STAGE_WIDTH, minHeight: STAGE_HEIGHT }}>
          <svg className="creator-node-edges" width={STAGE_WIDTH} height={STAGE_HEIGHT} aria-hidden="true">
            {edges.map((edge, index) => {
              const from = nodes.find((node) => node.id === edge.from);
              const to = nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              return <path key={edge.from + "-" + edge.to + "-" + index} d={bezier(portPoint(from, "out"), portPoint(to, "in"))} />;
            })}
            {linkRef.current && linkPos && (() => {
              const from = nodes.find((node) => node.id === linkRef.current?.from);
              return from ? <path className="creator-node-edge-preview" d={bezier(portPoint(from, "out"), linkPos)} /> : null;
            })()}
          </svg>

          {nodes.map((node) => {
            const selected = node.id === selectedId;
            const inputCount = edges.filter((edge) => edge.to === node.id).length;
            const nodeStyle: CSSProperties = {
              left: node.x,
              top: node.y,
              width: NODE_WIDTH,
              borderColor: selected ? "var(--accent)" : "var(--stroke-2)",
              boxShadow: selected ? "0 15px 42px -20px var(--accent), var(--inset)" : "var(--shadow)",
            };
            return (
              <article
                key={node.id}
                data-nodeid={node.id}
                className={"creator-node-card creator-node-" + node.kind}
                style={nodeStyle}
                onPointerDown={(event) => onNodePointerDown(event, node.id)}
                onContextMenu={(event) => openContextMenu(event, node.id)}
              >
                {node.kind === "gen" && <div className="creator-node-port input" data-port="input" onPointerUp={(event) => onPortUp(event, node.id)} title="输入端口" />}
                <div className="creator-node-port output" data-port="output" onPointerDown={(event) => onPortDown(event, node.id)} title="拖动连接到生成节点" />
                <header className="creator-node-card-head">
                  <span className="creator-node-icon"><Icon d={NODE_ICON[node.kind]} size={15} sw={1.7} /></span>
                  <span>{NODE_LABEL[node.kind]}</span>
                  <button type="button" className="creator-node-delete" aria-label={"删除" + NODE_LABEL[node.kind]} onClick={(event) => { event.stopPropagation(); deleteNode(node.id); }}>×</button>
                </header>

                {node.kind === "ref" && (
                  <div className="creator-node-card-body">
                    <div
                      className={"creator-node-reference " + (node.url ? "has-image" : "")}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files?.[0];
                        if (file) attachFileToNode(node.id, file);
                      }}
                    >
                      {node.url ? <img src={node.url} alt={node.label || "参考图"} /> : <><Icon d={NODE_ICON.ref} size={22} /><span>拖入图片，或点击选择</span></>}
                    </div>
                    <button type="button" className="creator-node-secondary-button" onClick={(event) => { event.stopPropagation(); pendingRefNodeRef.current = node.id; fileInputRef.current?.click(); }}>选择参考图</button>
                    <div className="creator-node-caption">{node.fileKey ? (node.label || "已绑定参考图") : "未绑定文件；连线后才会作为输入"}</div>
                  </div>
                )}

                {node.kind === "prompt" && (
                  <div className="creator-node-card-body">
                    <textarea
                      value={node.text || ""}
                      onChange={(event) => updatePromptNode(node.id, event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      placeholder="写下这条提示词…"
                      aria-label="提示词节点内容"
                    />
                    <div className="creator-node-caption">连到生图节点后，会合并为主 Prompt</div>
                  </div>
                )}

                {node.kind === "gen" && (
                  <div className="creator-node-card-body">
                    <div className="creator-node-output-preview">
                      <Icon d={NODE_ICON.gen} size={24} sw={1.5} />
                      <span>{generating && selectedGeneration === node.id ? "草稿准备中…" : "等待输入"}</span>
                    </div>
                    <div className="creator-node-input-count">{inputCount} 个输入 · 参考图与提示词由连线决定</div>
                    <button
                      type="button"
                      className="creator-node-generate-button"
                      disabled={!canGenerate || generating}
                      onClick={(event) => { event.stopPropagation(); generateFromNode(node.id); }}
                    >
                      {generating && selectedGeneration === node.id ? "准备中…" : "提交生图草稿"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="creator-node-context-menu"
            role="menu"
            style={{ left: contextMenu.viewX, top: contextMenu.viewY }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="creator-node-context-title">添加到画布</div>
            <button type="button" role="menuitem" onClick={() => addMenuNode("ref")}><Icon d={NODE_ICON.ref} size={14} />参考图节点</button>
            <button type="button" role="menuitem" onClick={() => addMenuNode("prompt")}><Icon d={NODE_ICON.prompt} size={14} />提示词节点</button>
            <button type="button" role="menuitem" onClick={() => addMenuNode("gen")}><Icon d={NODE_ICON.gen} size={14} />生图节点</button>
            {selectedId && <button type="button" role="menuitem" className="danger" onClick={() => deleteNode(selectedId)}><Icon d={["M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"]} size={14} />删除选中节点</button>}
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onReferenceFileChange} />
      <div className="creator-node-footer">
        <span><i className="creator-node-legend-dot" />连线到「生图节点」= 作为本次输入</span>
        <span className="fg-mono">{graphReferenceKeys.length}/{MAX_CREATOR_IMAGE_REFERENCES} 参考图 · {graphPrompt.length}/30k</span>
      </div>

      <style jsx>{`
        .creator-image-node-canvas { width: 100%; min-height: 650px; height: 100%; display: flex; flex-direction: column; margin: 0 !important; overflow: hidden; border: 1px solid var(--stroke-2); border-radius: 18px; background: color-mix(in srgb,var(--panel-solid) 76%,transparent); box-shadow: var(--shadow); }
        .creator-node-toolbar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 58px; padding: 9px 13px 9px 16px; border-bottom: 1px solid var(--stroke); background: color-mix(in srgb,var(--panel-solid) 82%,transparent); }
        .creator-node-kicker { color: var(--text-3); font-size: 8px; letter-spacing: 1.1px; }
        .creator-node-toolbar strong { display: block; margin-top: 4px; color: var(--text-2); font-size: 11.5px; font-weight: 600; }
        .creator-node-toolbar-actions { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
        .creator-node-toolbar-actions button { height: 30px; padding: 0 9px; border: 1px solid var(--stroke); border-radius: 8px; background: var(--panel); color: var(--text-2); cursor: pointer; font-size: 10.5px; }
        .creator-node-toolbar-actions button:hover { border-color: var(--stroke-2); color: var(--text); background: var(--panel-2); }
        .creator-node-toolbar-actions button.primary { border-color: var(--user-stroke); background: var(--user-bubble); color: var(--accent); }
        .creator-node-toolbar-actions button.subtle { color: var(--text-3); }
        .creator-node-viewport { position: relative; flex: 1; min-height: 0; overflow: auto; background: #09111a; scrollbar-gutter: stable; }
        .creator-node-stage { position: relative; background-image: linear-gradient(rgba(132,185,214,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(132,185,214,.045) 1px, transparent 1px), radial-gradient(circle at 50% 38%, rgba(116,240,142,.07), transparent 36%); background-size: 32px 32px, 32px 32px, auto; }
        .creator-node-edges { position: absolute; inset: 0; z-index: 1; overflow: visible; pointer-events: none; }
        .creator-node-edges path { fill: none; stroke: var(--accent); stroke-width: 2.1; opacity: .66; filter: drop-shadow(0 0 5px rgba(116,240,142,.28)); }
        .creator-node-edges path.creator-node-edge-preview { stroke: var(--accent-2); stroke-dasharray: 6 6; opacity: .9; }
        .creator-node-card { position: absolute; z-index: 2; overflow: visible; border: 1px solid; border-radius: 13px; background: var(--panel-solid); user-select: none; cursor: grab; transition: border-color .15s ease, box-shadow .15s ease; }
        .creator-node-card:active { cursor: grabbing; }
        .creator-node-card-head { display: flex; align-items: center; gap: 7px; height: 39px; padding: 0 9px; border-bottom: 1px solid var(--stroke); color: var(--text-2); font-size: 11.5px; font-weight: 650; }
        .creator-node-icon { display: grid; place-items: center; color: var(--accent); }
        .creator-node-delete { width: 22px; height: 22px; display: grid; place-items: center; margin-left: auto; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer; font-size: 16px; line-height: 1; }
        .creator-node-delete:hover { color: #ff9b85; background: rgba(255,119,89,.11); }
        .creator-node-card-body { padding: 9px; }
        .creator-node-port { position: absolute; top: 39px; z-index: 4; width: 13px; height: 13px; border: 2px solid var(--accent); border-radius: 50%; background: var(--panel-solid); box-shadow: 0 0 0 3px rgba(116,240,142,.09); }
        .creator-node-port.input { left: -8px; cursor: crosshair; }
        .creator-node-port.output { right: -8px; cursor: crosshair; background: var(--accent); }
        .creator-node-reference { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1 / .72; overflow: hidden; border: 1px dashed var(--stroke-2); border-radius: 9px; background: var(--bg-2); color: var(--text-3); text-align: center; }
        .creator-node-reference.has-image { border-style: solid; }
        .creator-node-reference img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .creator-node-reference span { max-width: 120px; margin-top: 5px; font-size: 10px; line-height: 1.45; }
        .creator-node-secondary-button,.creator-node-generate-button { width: 100%; height: 30px; margin-top: 8px; border-radius: 8px; cursor: pointer; font-size: 10.5px; }
        .creator-node-secondary-button { border: 1px solid var(--stroke); background: var(--panel); color: var(--text-2); }
        .creator-node-secondary-button:hover { border-color: var(--stroke-2); color: var(--text); }
        .creator-node-caption { margin-top: 7px; color: var(--text-3); font-size: 9.5px; line-height: 1.45; }
        .creator-node-prompt textarea { width: 100%; min-height: 116px; resize: vertical; padding: 8px; border: 1px solid var(--stroke); border-radius: 8px; outline: none; background: var(--panel); color: var(--text); font: inherit; font-size: 11px; line-height: 1.55; }
        .creator-node-prompt textarea:focus { border-color: var(--stroke-2); box-shadow: 0 0 0 2px rgba(116,240,142,.08); }
        .creator-node-prompt textarea::placeholder { color: var(--text-3); }
        .creator-node-output-preview { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 104px; border: 1px solid var(--stroke); border-radius: 9px; background: radial-gradient(circle at 50% 30%, rgba(116,240,142,.12), transparent 65%), var(--bg-2); color: var(--text-3); font-size: 10.5px; }
        .creator-node-output-preview svg { color: var(--accent); }
        .creator-node-input-count { margin-top: 8px; color: var(--text-3); font-size: 9.5px; line-height: 1.45; }
        .creator-node-generate-button { border: 0; background: var(--accent); color: var(--accent-ink); font-weight: 700; }
        .creator-node-generate-button:disabled { cursor: not-allowed; opacity: .42; }
        .creator-node-context-menu { position: absolute; z-index: 8; width: 208px; padding: 6px; border: 1px solid var(--stroke-2); border-radius: 12px; background: var(--panel-solid); box-shadow: 0 22px 56px rgba(0,0,0,.4); }
        .creator-node-context-title { padding: 6px 9px 7px; color: var(--text-3); font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: .7px; }
        .creator-node-context-menu button { width: 100%; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 9px; border: 0; border-radius: 8px; background: transparent; color: var(--text-2); cursor: pointer; font-size: 11.5px; text-align: left; }
        .creator-node-context-menu button:hover { background: var(--panel-2); color: var(--text); }
        .creator-node-context-menu button.danger { color: #ff9b85; }
        .creator-node-footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 13px; border-top: 1px solid var(--stroke); color: var(--text-3); font-size: 9.5px; }
        .creator-node-legend-dot { display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 9px var(--accent); }
        @media (max-width: 680px) { .creator-node-toolbar { align-items: flex-start; flex-direction: column; gap: 8px; } .creator-node-toolbar-actions { justify-content: flex-start; } .creator-node-footer { align-items: flex-start; flex-direction: column; } }
      `}</style>
    </section>
  );
}
