"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient, localMediaUrl } from "@/lib/local/client";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";
import { generateImage } from '@/lib/ai/image-client';
import { createVideoTask, getVideoTask, isActiveVideoTask } from '@/lib/ai/video-client';
import { getVideoModel, VIDEO_MODELS } from '@/lib/ai/video-models';
import { buildInitialCanvasGraph, type CanvasEdge, type CanvasKind, type CanvasNode } from '@/lib/canvas';
import StudioShell, { StageKey } from "@/components/studio/StudioShell";
import { Icon, Hov, EditArea } from "@/components/studio/ui";

type Kind = CanvasKind;
type Node = CanvasNode;
type Edge = CanvasEdge;
type Graph = { nodes: Node[]; edges: Edge[] };

const uid = () => Math.random().toString(36).slice(2, 9);
const KIND_ICON: Record<Kind, string[]> = {
  ref: ["M3 4h18v16H3z", "M9 9a2 2 0 1 0 0-.01", "m3 17 5-4 4 3 3-2 6 5"],
  prompt: ["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"],
  gen: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"],
  video: ["M3 5h18v14H3z", "m10 9 5 3-5 3z"],
};
const KIND_LABEL: Record<Kind, string> = { ref: "参考图", prompt: "提示词", gen: "图片节点", video: "视频节点" };

export default function GenCanvas({
  projectId, projectName, scope = 'assets', refKey = 'main', assetType = '人物', stageKey = 'assets', backHref,
  shotId, shotField, initialImageUrl, initialPrompt, initialVideoPrompt, shotDuration = 5, canvasTitle,
}: {
  projectId: string; projectName: string; scope?: string; refKey?: string; assetType?: string; stageKey?: StageKey; backHref: string;
  shotId?: string; shotField?: 'frame_path' | 'keyframe_path' | 'storyboard_path';
  initialImageUrl?: string | null; initialPrompt?: string | null; initialVideoPrompt?: string | null;
  shotDuration?: number; canvasTitle?: string;
}) {
  const router = useRouter();
  const sb = createClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [model, setModel] = useState(IMG_MODELS[0].id);
  const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0].id);
  const [videoResolution, setVideoResolution] = useState('720p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [ratio, setRatio] = useState(scope === 'shots' || scope === 'board' ? '16:9' : '9:16');
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const link = useRef<{ from: string } | null>(null);
  const [linkPos, setLinkPos] = useState<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveT = useRef<any>(null);

  // ---- load graph ----
  useEffect(() => {
    (async () => {
      setRowId(null);
      const { data } = await sb.from('canvases').select('id,graph').eq('project_id', projectId).eq('scope', scope).eq('ref_key', refKey).maybeSingle();
      if (data) { setRowId(data.id); const g = (data.graph || {}) as Graph; setNodes(g.nodes || []); setEdges(g.edges || []); }
      else { const graph = buildInitialCanvasGraph({ imageUrl: initialImageUrl, prompt: initialPrompt, videoPrompt: initialVideoPrompt }); setNodes(graph.nodes); setEdges(graph.edges); }
    })();
  }, [projectId, scope, refKey, initialImageUrl, initialPrompt, initialVideoPrompt]);

  const persist = useCallback((ns: Node[], es: Edge[]) => {
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      const graph = { nodes: ns.map(({ busy, ...n }) => n), edges: es };
      if (rowId) await sb.from("canvases").update({ graph, updated_at: new Date().toISOString() }).eq("id", rowId);
      else { const { data } = await sb.from("canvases").insert({ project_id: projectId, scope, ref_key: refKey, graph }).select("id").single(); if (data) setRowId(data.id); }
    }, 600);
  }, [rowId, projectId, scope, refKey]);

  const commit = (ns: Node[], es: Edge[] = edges) => { setNodes(ns); setEdges(es); persist(ns, es); };
  const activeVideoTasks = nodes
    .filter((node) => node.kind === 'video' && node.taskId && (node.status === 'queued' || node.status === 'running'))
    .map((node) => `${node.id}:${node.taskId}`)
    .join(',');

  useEffect(() => {
    if (!activeVideoTasks) return;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      const pairs = activeVideoTasks.split(',').map((entry) => {
        const split = entry.indexOf(':');
        return { nodeId: entry.slice(0, split), taskId: entry.slice(split + 1) };
      });
      const results = await Promise.allSettled(pairs.map((pair) => getVideoTask(pair.taskId)));
      if (!stopped) {
        let completed = false;
        setNodes((current) => {
          let changed = false;
          const next = current.map((node) => {
            const pairIndex = pairs.findIndex((pair) => pair.nodeId === node.id);
            const result = pairIndex >= 0 ? results[pairIndex] : null;
            if (!result || result.status !== 'fulfilled') return node;
            const task = result.value;
            const resultUrl = task.output?.videoUrl || node.result || null;
            if (task.status === node.status && resultUrl === node.result && (task.error || null) === (node.error || null)) return node;
            changed = true;
            if (task.status === 'succeeded') completed = true;
            return { ...node, status: task.status, result: resultUrl, error: task.error || null, busy: isActiveVideoTask(task) };
          });
          if (changed) persist(next, edges);
          return next;
        });
        if (completed) router.refresh();
      }
      polling = false;
    };
    const first = window.setTimeout(poll, 1800);
    const timer = window.setInterval(poll, 6500);
    return () => { stopped = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [activeVideoTasks, edges, persist, router]);

  // ---- add nodes ----
  function addNode(kind: Kind, extra: Partial<Node> = {}) {
    const r = canvasRef.current?.getBoundingClientRect();
    const x = (r ? r.width / 2 - 90 : 200) + (Math.random() * 80 - 40);
    const y = (r ? r.height / 2 - 60 : 160) + (Math.random() * 80 - 40);
    const n: Node = { id: uid(), kind, x, y, ...extra };
    const ns = [...nodes, n]; commit(ns); setSel(n.id);
  }
  async function addRefUpload(files: FileList | null) {
    if (!files || !files[0]) return;
    const f = files[0];
    const path = `${projectId}/canvas/ref-${Date.now()}-${uid()}.${(f.name.split(".").pop() || "png").toLowerCase()}`;
    const { error } = await sb.storage.from("project-assets").upload(path, f, { upsert: false });
    if (error) { alert('上传参考图失败：' + error.message); return; }
    const url = localMediaUrl("project-assets", path);
    addNode("ref", { url });
  }

  // ---- drag ----
  function onNodeDown(e: React.PointerEvent, id: string) {
    if ((e.target as HTMLElement).dataset.port) return;
    setSel(id);
    const n = nodes.find((x) => x.id === id); if (!n) return;
    const r = canvasRef.current!.getBoundingClientRect();
    drag.current = { id, ox: e.clientX - r.left - n.x, oy: e.clientY - r.top - n.y };
    e.stopPropagation();
  }
  // ---- linking ----
  function onPortDown(e: React.PointerEvent, id: string) {
    e.stopPropagation(); link.current = { from: id };
    const r = canvasRef.current!.getBoundingClientRect();
    setLinkPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }
  useEffect(() => {
    function move(e: PointerEvent) {
      const r = canvasRef.current?.getBoundingClientRect(); if (!r) return;
      if (drag.current) {
        const { id, ox, oy } = drag.current;
        setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x: Math.max(0, e.clientX - r.left - ox), y: Math.max(0, e.clientY - r.top - oy) } : n));
      } else if (link.current) setLinkPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    function up(e: PointerEvent) {
      if (drag.current) { drag.current = null; setNodes((ns) => { persist(ns, edges); return ns; }); }
      if (link.current) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const tgt = el?.closest("[data-nodeid]") as HTMLElement | null;
        const to = tgt?.dataset.nodeid; const from = link.current.from;
        if (to && to !== from && !edges.some((x) => x.from === from && x.to === to)) {
          const es = [...edges, { from, to }]; setEdges(es); persist(nodes, es);
        }
        link.current = null; setLinkPos(null);
      }
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [edges, nodes, persist]);

  function delNode(id: string) { const ns = nodes.filter((n) => n.id !== id); const es = edges.filter((e) => e.from !== id && e.to !== id); commit(ns, es); if (sel === id) setSel(null); }
  function setText(id: string, text: string) { const ns = nodes.map((n) => n.id === id ? { ...n, text } : n); commit(ns); }
  const inputsOf = (id: string) => edges.filter((e) => e.to === id).map((e) => nodes.find((n) => n.id === e.from)).filter(Boolean) as Node[];

  async function runGen(id: string) {
    const node = nodes.find((n) => n.id === id); if (!node) return;
    const ins = inputsOf(id);
    const prompt = ins.filter((n) => n.kind === "prompt").map((n) => n.text || "").filter(Boolean).join("，") || node.text || "";
    if (!prompt) { alert("生成节点需要连一个「提示词」节点，或在检查器里写提示词。"); return; }
    const refUrls = ins.filter((n) => (n.kind === "ref" || n.kind === "gen") && (n.url || n.result)).map((n) => (n.url || n.result) as string);
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, busy: true } : n));
    try {
      const payload: any = { projectId, type: assetType, model, size: sizeFor(model, ratio), prompt };
      if (refUrls.length) payload.refUrls = refUrls;
      if (shotId && shotField) { payload.shotId = shotId; payload.shotField = shotField; }
      const d = await generateImage(payload);
      const ns = nodes.map((n) => n.id === id ? { ...n, busy: false, result: d.url } : n); commit(ns); router.refresh();
    } catch (e: any) { alert("出错：" + (e?.message || "")); setNodes((ns) => ns.map((n) => n.id === id ? { ...n, busy: false } : n)); }
  }

  async function runVideo(id: string) {
    if (!shotId) { alert('视频节点只能在逐镜头独立画布中使用。'); return; }
    const node = nodes.find((item) => item.id === id); if (!node) return;
    const ins = inputsOf(id);
    const prompt = ins.filter((item) => item.kind === 'prompt').map((item) => item.text || '').filter(Boolean).join('，') || node.text || '';
    const refUrls = ins
      .filter((item) => (item.kind === 'ref' || item.kind === 'gen') && (item.url || item.result))
      .map((item) => (item.url || item.result) as string);
    if (!prompt && !refUrls.length) { alert('视频节点至少需要提示词或一张参考图。'); return; }
    setNodes((current) => current.map((item) => item.id === id ? { ...item, busy: true, status: 'queued', error: null } : item));
    try {
      const task = await createVideoTask({
        projectId,
        shotId,
        model: videoModel,
        prompt,
        references: refUrls.map((url, index) => ({ type: 'image' as const, url, role: index === 0 ? 'first_frame' as const : 'reference_image' as const })),
        duration: Math.max(4, Math.min(15, Math.round(shotDuration || 5))),
        ratio,
        resolution: videoResolution,
        watermark: false,
        generateAudio,
      });
      setNodes((current) => {
        const next = current.map((item) => item.id === id ? { ...item, busy: isActiveVideoTask(task), taskId: task.id, status: task.status, error: task.error || null } : item);
        persist(next, edges);
        return next;
      });
    } catch (error: any) {
      setNodes((current) => current.map((item) => item.id === id ? { ...item, busy: false, status: 'failed', error: error?.message || '视频任务提交失败' } : item));
    }
  }

  const selNode = nodes.find((n) => n.id === sel) || null;
  const selectedVideoModel = getVideoModel(videoModel) || VIDEO_MODELS[0];
  const PORT = (id: string, side: "in" | "out") => (
    <div data-port="1" onPointerDown={side === "out" ? (e) => onPortDown(e, id) : undefined}
      style={{ position: "absolute", [side === "in" ? "left" : "right"]: -7, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, borderRadius: "50%", background: side === "out" ? "var(--accent)" : "var(--panel-solid)", border: "2px solid var(--accent)", cursor: side === "out" ? "crosshair" : "default", zIndex: 3 } as any} />
  );

  // ---- edge path ----
  const portXY = (n: Node, side: "in" | "out") => ({ x: n.x + (side === "out" ? 184 : 0), y: n.y + 34 });
  const bez = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`; };

  const toolBtn = { display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" };

  // ---------- inspector ----------
  const inspector = (
    <aside style={{ flex: "none", width: 320, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px)", WebkitBackdropFilter: "blur(26px)" }}>
      {!selNode ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 30, textAlign: "center", color: "var(--text-3)" }}>
          <span style={{ width: 54, height: 54, borderRadius: 16, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--text-2)" }}><Icon d={["M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M6 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M18 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M8.2 7 15.5 11M8.2 17 15.5 13"]} size={26} sw={1.4} /></span>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6 }}>选中一个节点查看与编辑<br />或从顶部添加新节点</div>
        </div>
      ) : (
        <>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, padding: "15px 18px", borderBottom: "1px solid var(--stroke)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={KIND_ICON[selNode.kind]} size={16} sw={1.6} /></span>
            <div><div style={{ fontSize: 14, fontWeight: 600 }}>{KIND_LABEL[selNode.kind]}</div><div className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)" }}>node · {selNode.id}</div></div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
            {selNode.kind === "gen" && <>
              <div style={{ aspectRatio: "4/5", borderRadius: 14, overflow: "hidden", background: selNode.result ? "var(--bg-2)" : "var(--panel-2)", border: "1px solid var(--stroke-2)", position: "relative" }}>
                {selNode.result ? <img src={selNode.result} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{selNode.busy ? "生成中…" : "尚未生成"}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--text-2)" }}><span>输入连接</span><span className="fg-mono" style={{ color: "var(--text)" }}>{inputsOf(selNode.id).length} 个</span></div>
              <div style={{ display: "flex", gap: 7 }}>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="fg-mono" style={{ flex: 1, fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 9, padding: "7px 6px", cursor: "pointer" }}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</select>
                <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="fg-mono" style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 9, padding: "7px 6px", cursor: "pointer" }}>{RATIOS.map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}</select>
              </div>
              <button onClick={() => runGen(selNode.id)} disabled={selNode.busy} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 46, borderRadius: 13, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 9px 22px -10px var(--accent)", opacity: selNode.busy ? 0.6 : 1 }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={16} sw={1.9} />{selNode.busy ? "生成中…" : selNode.result ? "重新生成" : "运行生成"}</button>
              {selNode.result && <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center" }}>已自动存入「{assetType}」资产库</div>}
            </>}
            {selNode.kind === 'video' && <>
              <div style={{ aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-2)', border: '1px solid var(--stroke-2)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                {selNode.result ? <video src={selNode.result} controls preload='metadata' style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (selNode.status === 'queued' ? '排队中…' : selNode.status === 'running' ? '视频生成中…' : '尚未生成')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)' }}><span>输入连接</span><span className='fg-mono'>{inputsOf(selNode.id).length} 个</span></div>
              <select value={videoModel} onChange={(event) => {
                const next = getVideoModel(event.target.value);
                setVideoModel(event.target.value);
                if (next && !next.resolutions.includes(videoResolution)) setVideoResolution(next.resolutions.includes('720p') ? '720p' : next.resolutions[0]);
              }} className='fg-mono' style={{ width: '100%', fontSize: 10.5, color: 'var(--text-2)', background: 'var(--panel-solid)', border: '1px solid var(--stroke)', borderRadius: 9, padding: '8px 7px' }}>
                {VIDEO_MODELS.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 7 }}>
                <select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)} className='fg-mono' style={{ flex: 1, fontSize: 11, color: 'var(--text-2)', background: 'var(--panel-solid)', border: '1px solid var(--stroke)', borderRadius: 9, padding: '7px 6px' }}>{selectedVideoModel.resolutions.map((value) => <option key={value}>{value}</option>)}</select>
                <select value={ratio} onChange={(event) => setRatio(event.target.value)} className='fg-mono' style={{ flex: 1, fontSize: 11, color: 'var(--text-2)', background: 'var(--panel-solid)', border: '1px solid var(--stroke)', borderRadius: 9, padding: '7px 6px' }}>{RATIOS.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}</select>
              </div>
              <button onClick={() => setGenerateAudio((value) => !value)} style={{ height: 34, borderRadius: 9, color: generateAudio ? 'var(--accent)' : 'var(--text-3)', background: 'var(--panel-solid)', border: '1px solid var(--stroke)', cursor: 'pointer' }}>{generateAudio ? '✓ 同步生成音频' : '不生成音频'}</button>
              {selectedVideoModel.filterOff && <div style={{ fontSize: 10.5, lineHeight: 1.5, color: '#d6ad62' }}>FILTER OFF 版本关闭模型过滤；仍需遵守平台规则与适用法律。</div>}
              {selNode.error && <div style={{ fontSize: 11.5, color: '#ff7676' }}>{selNode.error}</div>}
              <button onClick={() => runVideo(selNode.id)} disabled={selNode.busy || selNode.status === 'queued' || selNode.status === 'running' || selNode.status === 'submitting' || selNode.status === 'unknown'} style={{ width: '100%', height: 46, borderRadius: 13, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--accent-ink)', background: 'var(--accent)', border: 'none', opacity: selNode.status === 'queued' || selNode.status === 'running' || selNode.status === 'submitting' || selNode.status === 'unknown' ? .6 : 1 }}>{selNode.status === 'queued' ? '排队中…' : selNode.status === 'running' ? '生成中…' : selNode.status === 'submitting' ? '提交中…' : selNode.status === 'unknown' ? '等待对账' : selNode.result ? '重新生成视频' : '运行视频生成'}</button>
            </>}
            {selNode.kind === "prompt" && <>
              <EditArea value={selNode.text || ""} minH={150} placeholder="在这里写出图提示词，连到「生成节点」即可作为其输入。" onSave={(v) => setText(selNode.id, v)} style={{ fontSize: 13, lineHeight: 1.65 }} />
            </>}
            {selNode.kind === "ref" && <>
              <div style={{ aspectRatio: "4/5", borderRadius: 14, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--stroke-2)" }}>{selNode.url && <img src={selNode.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>连一条线到「生成节点」，它会被当作参考图（保持角色/画风一致）。</div>
            </>}
            <button onClick={() => delNode(selNode.id)} style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, borderRadius: 11, cursor: "pointer", fontSize: 12.5, color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"]} size={14} sw={1.7} />删除节点</button>
          </div>
        </>
      )}
    </aside>
  );

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey={stageKey} right={inspector}>
      {/* toolbar */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "13px 22px", borderBottom: "1px solid var(--stroke)" }}>
        <Hov as="a" href={backHref} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["m15 6-6 6 6 6"]} size={16} sw={1.7} />返回</Hov>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ fontSize: 16, fontWeight: 600 }}>{canvasTitle || "节点画布"}</span><span className="fg-mono" style={{ fontSize: 10, color: "var(--accent)", padding: "2px 8px", borderRadius: 6, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>连线 = 参考图</span></div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}>拖动节点 · 拉线连接参考与提示词 · 图片/视频节点直接运行</div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginRight: 4 }}>添加节点</span>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { addRefUpload(e.target.files); e.currentTarget.value = ""; }} />
        <Hov as="button" onClick={() => fileRef.current?.click()} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel-2)", borderColor: "var(--stroke-2)" }}><Icon d={KIND_ICON.ref} size={15} sw={1.7} />参考图</Hov>
        <Hov as="button" onClick={() => addNode("prompt", { text: "" })} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel-2)", borderColor: "var(--stroke-2)" }}><Icon d={KIND_ICON.prompt} size={15} sw={1.7} />提示词</Hov>
        <Hov as="button" onClick={() => addNode("gen", { result: null })} base={{ ...toolBtn, color: "var(--accent-ink)", background: "var(--accent)", border: "none", fontWeight: 600, boxShadow: "var(--inset),0 8px 18px -8px var(--accent)" }} hover={{ filter: "brightness(1.08)" }}><Icon d={KIND_ICON.gen} size={15} sw={1.9} />生成节点</Hov>
        {shotId && <Hov as='button' onClick={() => addNode('video', { result: null })} base={{ ...toolBtn, color: 'var(--accent)', background: 'var(--user-bubble)', border: '1px solid var(--user-stroke)', fontWeight: 600 }} hover={{ filter: 'brightness(1.08)' }}><Icon d={KIND_ICON.video} size={15} sw={1.9} />视频节点</Hov>}
      </div>

      {/* canvas */}
      <div ref={canvasRef} onPointerDown={() => setSel(null)} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "var(--bg-2)", backgroundImage: "radial-gradient(circle, var(--stroke) 1px, transparent 1px)", backgroundSize: "22px 22px", touchAction: "none" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
          {edges.map((e, i) => { const a = nodes.find((n) => n.id === e.from); const b = nodes.find((n) => n.id === e.to); if (!a || !b) return null; return <path key={i} d={bez(portXY(a, "out"), portXY(b, "in"))} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.7} />; })}
          {link.current && linkPos && (() => { const a = nodes.find((n) => n.id === link.current!.from); return a ? <path d={bez(portXY(a, "out"), linkPos)} fill="none" stroke="var(--accent-2)" strokeWidth={2} strokeDasharray="5 5" /> : null; })()}
        </svg>

        {nodes.map((n) => {
          const on = sel === n.id;
          return (
            <div key={n.id} data-nodeid={n.id} onPointerDown={(e) => onNodeDown(e, n.id)}
              style={{ position: "absolute", left: n.x, top: n.y, width: 184, borderRadius: 14, background: "var(--panel-solid)", border: `1.5px solid ${on ? "var(--accent)" : "var(--stroke-2)"}`, boxShadow: on ? "var(--inset),0 10px 28px -12px var(--accent)" : "var(--shadow)", zIndex: on ? 4 : 2, cursor: "grab", userSelect: "none" }}>
              {(n.kind === "gen" || n.kind === 'video') && PORT(n.id, "in")}
              {PORT(n.id, "out")}
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", borderBottom: "1px solid var(--stroke)" }}>
                <span style={{ color: n.kind === "gen" || n.kind === 'video' ? "var(--accent)" : "var(--text-2)" }}><Icon d={KIND_ICON[n.kind]} size={14} sw={1.7} /></span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{KIND_LABEL[n.kind]}</span>
              </div>
              <div style={{ padding: 9 }}>
                {n.kind === "ref" && <div style={{ aspectRatio: "1/1", borderRadius: 9, overflow: "hidden", background: "var(--bg-2)" }}>{n.url && <img src={n.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>}
                {n.kind === "prompt" && <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, maxHeight: 66, overflow: "hidden" }}>{n.text || "（空，点开右侧检查器编辑）"}</div>}
                {n.kind === "gen" && <div style={{ aspectRatio: "1/1", borderRadius: 9, overflow: "hidden", background: "var(--bg-2)", display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 11 }}>{n.busy ? "生成中…" : n.result ? <img src={n.result} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "未生成"}</div>}
                {n.kind === 'video' && <div style={{ aspectRatio: '16/9', borderRadius: 9, overflow: 'hidden', background: 'var(--bg-2)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 10 }}>{n.result ? <video src={n.result} muted preload='metadata' style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : n.status === 'queued' ? '排队中…' : n.status === 'running' ? '生成中…' : n.status === 'submitting' ? '提交中…' : n.status === 'unknown' ? '等待对账' : n.status === 'failed' ? '生成失败' : '未生成'}</div>}
              </div>
            </div>
          );
        })}

        {nodes.length === 0 && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "var(--text-3)", fontSize: 14, textAlign: "center" }}>空画布 · 从右上「添加节点」开始<br />参考图 + 提示词 → 连到生成节点 → 运行</div>}
      </div>
    </StudioShell>
  );
}
