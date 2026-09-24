"use client";
import React, { useEffect, useRef, useState } from "react";
import { App, Button, ConfigProvider, Drawer, Empty, Input, Modal, Select, Tag, Tooltip, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ArrowDownToLine, ArrowUp, AudioLines, Box, Check, ChevronDown, ChevronRight, Clapperboard, Copy, FileText, Film, Focus, GripVertical, Image as ImageIcon, Keyboard, Layers3, LayoutGrid, Link2, Minus, MousePointer2, Plus, Redo2, Search, Settings2, Sparkles, Trash2, Undo2, Users, WandSparkles, X } from "lucide-react";
import ProductionLab from "./ProductionLab";
import inventory from "../../lib/production-lab/production-skills.json";
import { LAB_THEME_STORAGE_KEY, useLabTheme } from "../../lib/production-lab/use-lab-theme";
import AssetLibrary, { CanvasAssetPicture } from "./AssetLibrary";
import ProductionMediaQueue from "./ProductionMediaQueue";
import ScriptComparison from "./ScriptComparison";
import ProductionAgent from "./ProductionAgent";
import { applyDraft, createDraft, kindLabels, type DraftGraph, type DraftKind, type DraftNode, type DraftOperation } from "../../lib/production-lab/canvas-draft";
import { applyCommand, demoState, type Actor, type Command, type LabState, type Project, type ScriptTask } from "../../lib/production-lab/domain";
import { activeProjectStorageKey, projectCanvasStorageKey, projectCanvasRecoveryStorageKey, PRODUCTION_LAB_DEMO_STATE_KEY, PRODUCTION_LAB_LEGACY_CANVAS_KEY } from "../../lib/production-lab/storage-keys";
import { autoLayoutDraftGraph } from "../../lib/production-lab/canvas-auto-layout";
import { buildProjectStartGraph, buildScriptStoryboardGraph } from "../../lib/production-lab/production-flow";
import { isCanvasEditableTarget, nextDraftPosition, zoomAtPoint } from "../../lib/production-lab/canvas-interactions";
import c from "./CreativeWorkspace.module.css";
const icons = { text: FileText, character: Users, scene: ImageIcon, shot: Clapperboard, video: Film, audio: AudioLines };
type ProjectContext = { project: Project; tasks: ScriptTask[]; revision: number };
const demoActor: Actor = { id: "demo-user", name: "测试负责人", reviewer: true };
function contextFromState(state: LabState, preferredProjectId?: string): ProjectContext | null {
  const project = state.projects.find(item => item.id === preferredProjectId) || state.projects[0];
  return project ? { project, tasks: state.tasks.filter(task => task.projectId === project.id).sort((a,b) => a.episode-b.episode), revision: state.revision } : null;
}
function projectInitialGraph(context: ProjectContext | null, episode: number): DraftGraph {
  if (!context) return { nodes: [], edges: [] };
  const task = context.tasks.find(item => item.episode === episode);
  return buildProjectStartGraph(context.project, task, episode);
}
const skillName: Record<string, string> = { "deepwhite-screenwriting-v1": "DeepWhite 编剧", screenwriter: "剧作结构与对白", "deepwhite-director-shooting-v3-7": "导演分镜", "deepwhite-shotlist-builder-zh-user": "镜头表", "deepwhite-image-prompt-builder": "角色 / 场景设定", acting: "人物表演", "seedance-director": "Seedance 镜头编排", "seedance-emotion-director": "情绪与节奏", "seedance-combat-prompt": "动作与战斗", "cinedance-higgsfield": "镜头与空间连续性", "xiaotang-aigc-tvc-sop": "商业 TVC", "gpt-image-2-style-library": "图像风格库", "deepwhite-blender-previs": "Blender 空间预演" };
export default function CreativeWorkspace(props: { demo?: boolean; actor?: Actor }) {
  const [area, setArea] = useState("canvas");
  const [activeProject, setActiveProject] = useState<ProjectContext | null>(null);
  const [projectError, setProjectError] = useState("");
  const appearance = useLabTheme(v => v.theme);
  const [appearanceReady, setAppearanceReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAB_THEME_STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as { state?: { theme?: unknown } }).state?.theme : undefined;
      if (saved === "light" || saved === "dark") useLabTheme.getState().setTheme(saved);
    } catch { /* Keep the default theme when local storage is unavailable or malformed. */ }
    setAppearanceReady(true);
  }, []);
  const actorId = props.actor?.id || demoActor.id;
  async function readLabState(): Promise<LabState> {
    if (props.demo) {
      const raw = localStorage.getItem(PRODUCTION_LAB_DEMO_STATE_KEY);
      if (raw) return JSON.parse(raw) as LabState;
      const seeded = demoState();
      localStorage.setItem(PRODUCTION_LAB_DEMO_STATE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const response = await fetch("/api/production-lab", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "项目数据读取失败");
    return body.state as LabState;
  }
  function applyContext(state: LabState, projectId?: string) {
    const next = contextFromState(state, projectId);
    setActiveProject(next);
    if (next) localStorage.setItem(activeProjectStorageKey(actorId), next.project.id);
    return next;
  }
  async function commitProjectCommand(projectId: string, command: Command): Promise<LabState> {
    if (props.demo) {
      const current = await readLabState();
      const next = applyCommand(current, command, demoActor);
      localStorage.setItem(PRODUCTION_LAB_DEMO_STATE_KEY, JSON.stringify(next));
      applyContext(next, projectId);
      return next;
    }
    const current = await readLabState();
    const response = await fetch("/api/production-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: current.revision, command }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "项目更新失败");
    applyContext(body.state as LabState, projectId);
    return body.state as LabState;
  }
  async function openProject(projectId: string) {
    try {
      const state = await readLabState();
      if (!contextFromState(state, projectId)) throw new Error("项目不存在或当前账号无权访问");
      applyContext(state, projectId);
      setProjectError("");
      setArea("canvas");
    } catch (error) { setProjectError(error instanceof Error ? error.message : "项目读取失败"); }
  }
  async function prepareBatch(projectId: string, from: number, count: number) {
    const state = await readLabState();
    const project = state.projects.find(item => item.id === projectId);
    if (!project) throw new Error("项目不存在，请从项目列表重新打开");
    const existing = new Set(state.tasks.filter(item => item.projectId === projectId).map(item => item.episode));
    const conflict = Array.from({ length: count }, (_, index) => from + index).find(episode => existing.has(episode));
    if (conflict) throw new Error(`第 ${conflict} 集已有关联任务。新批次请从空闲集号开始，避免覆盖审核版本。`);
    if (!Number.isInteger(from) || from < 1 || from + count > 201) throw new Error("集号范围为 1–200");
    await commitProjectCommand(projectId, { type: "plan-scripts", projectId, from, count });
    const next = await readLabState();
    applyContext(next, projectId);
    return next.tasks.filter(item => item.projectId === projectId && item.episode >= from && item.episode < from + count).sort((a,b) => a.episode-b.episode);
  }
  async function saveSelectedScript(projectId: string, episode: number, content: string, source: "模型生成" | "人工录入", modelId?: string, requestId?: string) {
    const state = await readLabState();
    const task = state.tasks.find(item => item.projectId === projectId && item.episode === episode);
    if (!task) throw new Error("请先在批量剧本工作台建立对应分集任务");
    const next = await commitProjectCommand(projectId, { type: "save-script", taskId: task.id, content, source, modelId, requestId });
    return next.tasks.find(item => item.id === task.id)!;
  }
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const preferred = localStorage.getItem(activeProjectStorageKey(actorId)) || undefined;
        const next = contextFromState(await readLabState(), preferred);
        if (disposed) return;
        setActiveProject(next);
        if (next) localStorage.setItem(activeProjectStorageKey(actorId), next.project.id);
        setProjectError("");
      } catch (error) {
        if (!disposed) setProjectError(error instanceof Error ? error.message : "项目读取失败");
      }
    })();
    return () => { disposed = true; };
  }, [props.demo, actorId]);
  const content = area === "management"
    ? <ProductionLab {...props} appearance={appearance} onBackToWorkspace={() => setArea("canvas")} onOpenWorkspace={openProject} />
    : <Workspace demo={props.demo} actorId={actorId} projectContext={activeProject} projectError={projectError} appearanceReady={appearanceReady} onManagement={() => setArea("management")} onPrepareBatch={prepareBatch} onSaveScript={saveSelectedScript} />;
  return <ConfigProvider locale={zhCN} theme={{ algorithm: appearance === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: appearance === "dark" ? "#91b9e8" : "#496f9f", colorBgContainer: appearance === "dark" ? "#171c25" : "#fffdfa", borderRadius: 9, fontFamily: "'Segoe UI Variable', Aptos, 'PingFang SC', 'Microsoft YaHei UI', sans-serif" } }}><App>{content}</App></ConfigProvider>;
}
const NODE_WIDTH = 320;
const NODE_ESTIMATED_HEIGHT = 420;
const NODE_PORT_Y = 190;
function Workspace({ onManagement, demo, actorId, projectContext, projectError, appearanceReady, onPrepareBatch, onSaveScript }: { onManagement: () => void; demo?: boolean; actorId: string; projectContext: ProjectContext | null; projectError: string; appearanceReady: boolean; onPrepareBatch: (projectId: string, from: number, count: number) => Promise<ScriptTask[]>; onSaveScript: (projectId: string, episode: number, content: string, source: "模型生成" | "人工录入", modelId?: string, requestId?: string) => Promise<ScriptTask> }) {
  const appearance = useLabTheme(v => v.theme);
  const setAppearance = useLabTheme(v => v.setTheme);
  const [inertia, setInertia] = useState(true);
  const motionFrame = useRef(0);
  const velocity = useRef({ x:0, y:0, time:0, px:0, py:0 });
  useEffect(() => () => cancelAnimationFrame(motionFrame.current), []);
  const { message } = App.useApp();
  const [activeEpisode, setActiveEpisode] = useState(projectContext?.tasks[0]?.episode || 1);
  const [graph, setGraph] = useState<DraftGraph>({ nodes: [], edges: [] });
  const [ready, setReady] = useState(false);
  const loadedStorageKey = useRef("");
  const canvasVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [canvasSync, setCanvasSync] = useState<"loading" | "saved" | "saving" | "local" | "conflict" | "error">("loading");
  const canvasSyncRef = useRef(canvasSync);
  canvasSyncRef.current = canvasSync;
  const projectId = projectContext?.project.id;
  const canvasStorageKey = projectId ? projectCanvasStorageKey(actorId, projectId, activeEpisode) : "";
  const [past, setPast] = useState<DraftGraph[]>([]);
  const [future, setFuture] = useState<DraftGraph[]>([]);
  const [selected, setSelected] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    const available = new Set(graph.nodes.map(item => item.id));
    setSelectedIds(current => {
      const next = current.filter(id => available.has(id));
      return next.length === current.length ? current : next;
    });
    setSelected(current => current && available.has(current) ? current : undefined);
  }, [graph]);
  const [tab, setTab] = useState("canvas");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });
  const dockRef = useRef<HTMLDivElement>(null);
  const dockDrag = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number; boardLeft: number; boardTop: number; boardWidth: number; boardHeight: number; offsetX: number; offsetY: number }>();
  const dockStorageKey = `fg-production-lab-canvas-dock-v1:${actorId}`;
  const [skills, setSkills] = useState<string[]>(["seedance-director", "acting"]);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillCategory, setSkillCategory] = useState("全部");
  const [events, setEvents] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<string>();
  const [viewport, setViewportState] = useState({ x: 10, y: 0, k: 1 });
  const viewportRef = useRef(viewport);
  const viewportTargetRef = useRef(viewport);
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  const [mobilePanel, setMobilePanel] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const initialFitKey = useRef("");
  const fitGraphRef = useRef<() => void>(() => {});
  const drag = useRef<{ id?: string; ids?: string[]; origins?: { id: string; x: number; y: number }[]; x: number; y: number; nx: number; ny: number; dx?: number; dy?: number; before: DraftGraph; moved: boolean; duplicated?: boolean; marquee?: boolean }>();
  const nodeClipboard = useRef<DraftNode[]>([]);
  const spaceHeld = useRef(false);
  const editBefore = useRef<DraftGraph>();
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(dockStorageKey) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setDockOffset({ x: saved.x, y: saved.y });
    } catch { /* Keep the default toolbar position when local storage is unavailable or malformed. */ }
  }, [dockStorageKey]);
  useEffect(() => {
    try { localStorage.setItem(dockStorageKey, JSON.stringify(dockOffset)); }
    catch { /* The toolbar remains draggable for this session if storage is unavailable. */ }
  }, [dockOffset, dockStorageKey]);
  function beginDockDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault(); event.stopPropagation();
    const board = boardRef.current?.getBoundingClientRect(), dock = dockRef.current?.getBoundingClientRect();
    if (!board || !dock) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dockDrag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: dock.left, top: dock.top, width: dock.width, height: dock.height, boardLeft: board.left, boardTop: board.top, boardWidth: board.width, boardHeight: board.height, offsetX: dockOffset.x, offsetY: dockOffset.y };
  }
  function moveDock(event: React.PointerEvent<HTMLDivElement>) {
    const current = dockDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const left = Math.max(current.boardLeft + 8, Math.min(current.boardLeft + current.boardWidth - current.width - 8, current.left + event.clientX - current.startX));
    const top = Math.max(current.boardTop + 8, Math.min(current.boardTop + current.boardHeight - current.height - 8, current.top + event.clientY - current.startY));
    setDockOffset({ x: current.offsetX + left - current.left, y: current.offsetY + top - current.top });
  }
  function endDockDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (dockDrag.current?.pointerId === event.pointerId) dockDrag.current = undefined;
  }
  function nudgeDock(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const delta = event.shiftKey ? 48 : 20;
    const movement = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[event.key] as [number, number] | undefined;
    if (!movement) return;
    event.preventDefault();
    const board = boardRef.current?.getBoundingClientRect(), dock = dockRef.current?.getBoundingClientRect();
    if (!board || !dock) return;
    const left = Math.max(board.left + 8, Math.min(board.right - dock.width - 8, dock.left + movement[0]));
    const top = Math.max(board.top + 8, Math.min(board.bottom - dock.height - 8, dock.top + movement[1]));
    setDockOffset(current => ({ x: current.x + left - dock.left, y: current.y + top - dock.top }));
  }
  function writeViewport(next: { x: number; y: number; k: number }) {
    viewportRef.current = next;
    if (worldRef.current) worldRef.current.style.transform = `translate3d(${next.x}px,${next.y}px,0) scale(${next.k})`;
  }
  function setViewport(next: { x: number; y: number; k: number } | ((current: { x: number; y: number; k: number }) => { x: number; y: number; k: number })) {
    cancelAnimationFrame(motionFrame.current);
    const value = typeof next === "function" ? next(viewportRef.current) : next;
    viewportTargetRef.current = value;
    writeViewport(value);
    setViewportState(value);
  }
  function animateViewport(target: { x: number; y: number; k: number }, duration = 145) {
    cancelAnimationFrame(motionFrame.current);
    const start = viewportRef.current;
    viewportTargetRef.current = target;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      writeViewport({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        k: start.k + (target.k - start.k) * eased,
      });
      if (progress < 1) motionFrame.current = requestAnimationFrame(tick);
      else { writeViewport(target); setViewportState(target); }
    };
    motionFrame.current = requestAnimationFrame(tick);
  }
  function publishViewport() { viewportTargetRef.current = viewportRef.current; setViewportState(viewportRef.current); }
  function fitGraph(nodes = graph.nodes) {
    const board = boardRef.current?.getBoundingClientRect();
    if (!board || !nodes.length) { setViewport({ x: 16, y: 0, k: 1 }); return; }
    const measured = new Map<string, { width: number; height: number }>();
    worldRef.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach(element => {
      const id = element.dataset.nodeId;
      if (id) measured.set(id, { width: element.offsetWidth, height: element.offsetHeight });
    });
    const bounds = nodes.map(item => {
      const size = measured.get(item.id) || { width: NODE_WIDTH, height: NODE_ESTIMATED_HEIGHT };
      return { left: item.x, top: item.y, right: item.x + size.width, bottom: item.y + size.height };
    });
    const minX = Math.min(...bounds.map(item => item.left));
    const minY = Math.min(...bounds.map(item => item.top));
    const maxX = Math.max(...bounds.map(item => item.right));
    const maxY = Math.max(...bounds.map(item => item.bottom));
    const width = maxX - minX, height = maxY - minY;
    const scale = Math.max(0.5, Math.min(1.34, (board.width - 180) / width, (board.height - 230) / height));
    setViewport({
      x: board.width / 2 - (minX + width / 2) * scale,
      y: board.height / 2 + 16 - 100 - (minY + height / 2) * scale,
      k: scale,
    });
  }
  fitGraphRef.current = () => fitGraph();
  useEffect(() => {
    if (!ready || !canvasStorageKey || !graph.nodes.length || loadedStorageKey.current !== canvasStorageKey || initialFitKey.current === canvasStorageKey) return;
    initialFitKey.current = canvasStorageKey;
    const frame = requestAnimationFrame(() => fitGraphRef.current());
    return () => cancelAnimationFrame(frame);
  }, [ready, canvasStorageKey, graph.nodes.length]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const handleWheel = (event: WheelEvent) => {
      const textBody = (event.target as HTMLElement).closest<HTMLElement>(`.${c.nodeBody} p`);
      if (!event.ctrlKey && !event.metaKey && textBody && textBody.scrollHeight > textBody.clientHeight) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = board.getBoundingClientRect();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? board.clientHeight : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        animateViewport(zoomAtPoint(viewportTargetRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, deltaY), 120);
      } else {
        const current = viewportTargetRef.current;
        animateViewport({ x: current.x - (event.shiftKey ? (deltaY || deltaX) : deltaX), y: event.shiftKey ? current.y : current.y - deltaY, k: current.k }, 90);
      }
    };
    board.addEventListener("wheel", handleWheel, { passive: false });
    return () => board.removeEventListener("wheel", handleWheel);
  }, [tab]);
  const node = graph.nodes.find(n => n.id === selected);
  const mapBounds = graph.nodes.length ? graph.nodes.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.x), minY: Math.min(bounds.minY, item.y),
    maxX: Math.max(bounds.maxX, item.x + NODE_WIDTH), maxY: Math.max(bounds.maxY, item.y + NODE_ESTIMATED_HEIGHT),
    }), { minX: 0, minY: 0, maxX: 520, maxY: 440 }) : { minX: 0, minY: 0, maxX: 520, maxY: 440 };
  const mapScale = Math.min(150 / Math.max(500, mapBounds.maxX - mapBounds.minX), 82 / Math.max(360, mapBounds.maxY - mapBounds.minY));
  const mapWidth = (mapBounds.maxX - mapBounds.minX) * mapScale, mapHeight = (mapBounds.maxY - mapBounds.minY) * mapScale;
  useEffect(() => {
    if (!projectContext) return;
    if (!projectContext.tasks.some(task => task.episode === activeEpisode)) setActiveEpisode(projectContext.tasks[0]?.episode || 1);
  }, [projectId, activeEpisode, projectContext?.tasks.map(task => task.episode).join(",")]);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setCanvasSync("loading");
    if (!canvasStorageKey || !projectContext) {
      setGraph({ nodes: [], edges: [] }); loadedStorageKey.current = ""; canvasVersion.current = 0;
      setReady(true); setCanvasSync("local"); return;
    }
    void (async () => {
      try {
        const localRaw = localStorage.getItem(canvasStorageKey);
        let saved: DraftGraph | null = null;
        let version = 0;
        if (demo) {
          if (localRaw) saved = JSON.parse(localRaw);
          else {
            const legacy = localStorage.getItem(PRODUCTION_LAB_LEGACY_CANVAS_KEY);
            saved = legacy ? JSON.parse(legacy) : projectInitialGraph(projectContext, activeEpisode);
          }
        } else {
          const response = await fetch(`/api/production-lab/canvas?projectId=${encodeURIComponent(projectContext.project.id)}&episode=${activeEpisode}`, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "项目画布读取失败");
          saved = data.graph || (localRaw ? JSON.parse(localRaw) : projectInitialGraph(projectContext, activeEpisode));
          version = Number(data.version || 0);
        }
        if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) throw new Error("画布格式无效");
        if (cancelled) return;
        canvasVersion.current = version;
        loadedStorageKey.current = canvasStorageKey;
        localStorage.setItem(canvasStorageKey, JSON.stringify(saved));
        setGraph(saved); setPast([]); setFuture([]); setSelected(undefined); setSelectedIds([]); setReady(true); setCanvasSync(demo ? "local" : "saved");
      } catch (error) {
        if (cancelled) return;
        const localRaw = localStorage.getItem(canvasStorageKey);
        if (localRaw) {
          try {
            const backup = JSON.parse(localRaw) as DraftGraph;
            if (!Array.isArray(backup.nodes) || !Array.isArray(backup.edges)) throw new Error();
            loadedStorageKey.current = canvasStorageKey; canvasVersion.current = 0;
            setGraph(backup); setReady(true); setCanvasSync("error");
            message.warning((error instanceof Error ? error.message : "服务端画布暂不可用") + "；已打开本机副本，恢复连接前不会覆盖服务端版本。");
            return;
          } catch { /* Invalid backup remains untouched for recovery. */ }
        }
        loadedStorageKey.current = canvasStorageKey; canvasVersion.current = 0;
        setGraph(projectInitialGraph(projectContext, activeEpisode)); setReady(true); setCanvasSync("error");
        message.error(error instanceof Error ? error.message : "该分集画布暂不可读取");
      }
    })();
    return () => { cancelled = true; };
  }, [canvasStorageKey, projectId, activeEpisode, actorId, demo]);
  useEffect(() => {
    if (!ready || !canvasStorageKey || loadedStorageKey.current !== canvasStorageKey) return;
    try { localStorage.setItem(canvasStorageKey, JSON.stringify(graph)); }
    catch { setCanvasSync("error"); message.error("本机副本保存失败，请立即导出画布。"); return; }
    if (demo) { setCanvasSync("local"); return; }
    if (canvasSyncRef.current === "conflict" || canvasSyncRef.current === "error") return;
    setCanvasSync("saving");
    const snapshot = graph;
    const projectIdForSave = projectContext?.project.id;
    const episodeForSave = activeEpisode;
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (!projectIdForSave) return;
        const response = await fetch("/api/production-lab/canvas", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: projectIdForSave, episode: episodeForSave, expectedVersion: canvasVersion.current, graph: snapshot }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) { setCanvasSync("conflict"); message.error(data.error || "此分集画布有并发修改，已保留本机副本"); }
          else { setCanvasSync("error"); message.warning(data.error || "画布暂时只保存在本机，请检查同步状态"); }
          return;
        }
        canvasVersion.current = Number(data.version);
        setCanvasSync("saved");
      }).catch(() => { setCanvasSync("error"); message.warning("画布暂时只保存在本机，稍后可继续编辑并重试保存"); });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [graph, ready, canvasStorageKey, projectContext?.project.id, activeEpisode, demo, message]);
  function change(next: DraftGraph) { setPast(p => [...p.slice(-29), graph]); setFuture([]); setGraph(next); }
  function commit(ops: DraftOperation[]) { try { const next = applyDraft(graph, ops); change(next); setEvents(v => [`已写入 ${ops.filter(o => o.type === "add").length} 个草稿节点 · 未调用模型`, ...v]); return true; } catch (e) { message.error((e as Error).message); return false; } }
  function applyAgentOperations(ops: DraftOperation[]) {
    const created = ops.filter((operation): operation is Extract<DraftOperation, { type: "add" }> => operation.type === "add").map(operation => operation.node);
    if (!commit(ops)) return false;
    if (created.length) { setSelectedIds(created.map(item => item.id)); setSelected(created.at(-1)?.id); }
    return true;
  }
  function add(kind: DraftKind, screen?: { x: number; y: number }) { const position = nextDraftPosition(graph, viewportRef.current, screen); const n = createDraft(kind, `新${kindLabels[kind]}`, "", position.x, position.y); if (commit([{ type: "add", node: n }])) { setSelected(n.id); setSelectedIds([n.id]); } }
  function select(id: string, additive = false) {
    if (connecting) { if (connecting !== id) commit([{ type: "connect", from: connecting, to: id }]); setConnecting(undefined); }
    const next = additive ? selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id] : selectedIds.includes(id) ? selectedIds : [id];
    setSelectedIds(next);
    setSelected(next.includes(id) ? id : next.at(-1));
  }
  function undo() { if (!past.length) return; setFuture(value => [graph, ...value]); setGraph(past[past.length - 1]); setPast(value => value.slice(0, -1)); }
  function redo() { if (!future.length) return; setPast(value => [...value, graph]); setGraph(future[0]); setFuture(value => value.slice(1)); }
  function copySelection() {
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    nodeClipboard.current = graph.nodes.filter(item => ids.includes(item.id)).map(item => structuredClone(item));
    if (!nodeClipboard.current.length) message.info("先选择要复制的节点");
  }
  function pasteSelection() {
    if (!nodeClipboard.current.length) return;
    const map = new Map(nodeClipboard.current.map(item => [item.id, crypto.randomUUID()]));
    const origin = nextDraftPosition(graph, viewportRef.current);
    const minX = Math.min(...nodeClipboard.current.map(item => item.x)), minY = Math.min(...nodeClipboard.current.map(item => item.y));
    const nodes = nodeClipboard.current.map(item => ({ ...structuredClone(item), id: map.get(item.id)!, x: origin.x + item.x - minX, y: origin.y + item.y - minY }));
    const ops: DraftOperation[] = nodes.map(node => ({ type: "add", node }));
    for (const edge of graph.edges) if (map.has(edge.from) && map.has(edge.to)) ops.push({ type: "connect", from: map.get(edge.from)!, to: map.get(edge.to)! });
    if (commit(ops)) { setSelectedIds(nodes.map(item => item.id)); setSelected(nodes[0].id); }
  }
  function duplicateSelection() {
    if (!selectedIds.length && !selected) return;
    copySelection();
    pasteSelection();
  }
  function deleteSelection() {
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    if (ids.length && commit([{ type: "delete", ids }])) { setSelected(undefined); setSelectedIds([]); }
  }
  function finishInspectorEdit() {
    const before = editBefore.current;
    if (before && before !== graph) { setPast(value => [...value.slice(-29), before]); setFuture([]); }
    editBefore.current = undefined;
  }
  function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (isCanvasEditableTarget(event.target)) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "c" && window.getSelection()?.toString()) return;
    if (event.code === "Space") { spaceHeld.current = true; event.preventDefault(); return; }
    if (event.key === "Escape") { setConnecting(undefined); setSelected(undefined); setSelectedIds([]); return; }
    if (event.key === "Tab" && !command) { event.preventDefault(); add("text"); return; }
    if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    if (command && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); return; }
    if (command && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); return; }
    if (command && event.key.toLowerCase() === "l") { event.preventDefault(); if (!selected) message.info("先选中连线起点"); else { setConnecting(selected); message.info("选择目标节点完成连线"); } return; }
    if (command && (event.key === "+" || event.key === "=" || event.key === "-")) {
      event.preventDefault();
      const rect = boardRef.current?.getBoundingClientRect(); if (!rect) return;
      const center = { x: rect.width / 2, y: rect.height / 2 };
      animateViewport(zoomAtPoint(viewportRef.current, center, event.key === "-" ? 120 : -120));
      return;
    }
    if (command && event.key === "0") { event.preventDefault(); fitGraph(); return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
  }
  function exportGraph(value: DraftGraph = graph) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `FG-${projectContext?.project.title || "制作"}-EP${activeEpisode}-本机画布副本.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function toggleAppearance() {
    const next = appearance === "dark" ? "light" : "dark";
    setAppearance(next);
    try { localStorage.setItem(LAB_THEME_STORAGE_KEY, JSON.stringify({ state: { theme: next }, version: 0 })); } catch { message.warning("主题已切换，但浏览器未允许保存偏好"); }
  }
  function retryCanvasSync() {
    if (!projectId || demo || !graph) return;
    setCanvasSync("saved");
    setGraph(value => ({ ...value, nodes: [...value.nodes], edges: [...value.edges] }));
  }
  function loadServerCanvas() {
    if (!projectId || demo) return;
    Modal.confirm({
      title: "载入服务器画布版本？",
      content: "当前本机副本会先另存为本机恢复副本，再载入服务器版本。建议先下载一份 JSON 备份。",
      okText: "载入服务器版本",
      cancelText: "继续保留本机版本",
      onOk: async () => {
        const response = await fetch(`/api/production-lab/canvas?projectId=${encodeURIComponent(projectId)}&episode=${activeEpisode}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "服务器画布读取失败");
        const next = data.graph || projectInitialGraph(projectContext, activeEpisode);
        if (!Array.isArray(next.nodes) || !Array.isArray(next.edges)) throw new Error("服务器画布格式无效");
        localStorage.setItem(projectCanvasRecoveryStorageKey(actorId, projectId, activeEpisode), JSON.stringify({ savedAt: new Date().toISOString(), graph }));
        canvasVersion.current = Number(data.version || 0);
        loadedStorageKey.current = canvasStorageKey;
        setGraph(next); setPast([]); setFuture([]); setSelected(undefined); setSelectedIds([]); setCanvasSync("saved");
        message.success("服务器版本已载入；本机旧副本仍保留在恢复副本中");
      },
    });
  }
  function arrangeGraph() {
    if (graph.nodes.length < 2) { message.info("至少需要两个节点，才能按素材关系排布"); return; }
    const arranged = autoLayoutDraftGraph(graph);
    change(arranged);
    requestAnimationFrame(() => fitGraph(arranged.nodes));
    setEvents(v => ["按素材连线自动排布节点", ...v]);
  }
  function navigateMinimap(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect(), board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    const worldX = mapBounds.minX + (event.clientX - rect.left - 8) / mapScale;
    const worldY = mapBounds.minY + (event.clientY - rect.top - 24) / mapScale;
    const view = viewportRef.current;
    animateViewport({ ...view, x: board.width / 2 - worldX * view.k, y: board.height / 2 - worldY * view.k });
  }
  function edgePath(a: DraftNode, b: DraftNode, offsetA = { x: 0, y: 0 }, offsetB = { x: 0, y: 0 }) {
    return `M${a.x + NODE_WIDTH + offsetA.x},${a.y + NODE_PORT_Y + offsetA.y} C${a.x + NODE_WIDTH + 52 + offsetA.x},${a.y + NODE_PORT_Y + offsetA.y} ${b.x - 52 + offsetB.x},${b.y + NODE_PORT_Y + offsetB.y} ${b.x + offsetB.x},${b.y + NODE_PORT_Y + offsetB.y}`;
  }
  function paintNodeDragPreview(origins: { id: string; x: number; y: number }[], dx: number, dy: number) {
    const worldDx = dx / viewportRef.current.k, worldDy = dy / viewportRef.current.k;
    const moving = new Set(origins.map(point => point.id));
    for (const element of Array.from(worldRef.current?.querySelectorAll<HTMLElement>("article[data-node-id]") || [])) {
      if (moving.has(element.dataset.nodeId || "")) {
        element.style.willChange = "transform";
        element.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      }
    }
    graph.edges.forEach((edge, index) => {
      const a = graph.nodes.find(item => item.id === edge.from), b = graph.nodes.find(item => item.id === edge.to);
      const path = worldRef.current?.querySelector<SVGPathElement>(`path[data-edge-index="${index}"]`);
      if (a && b && path) path.setAttribute("d", edgePath(a, b, moving.has(a.id) ? { x: worldDx, y: worldDy } : undefined, moving.has(b.id) ? { x: worldDx, y: worldDy } : undefined));
    });
  }
  function clearNodeDragPreview(value: DraftGraph = graph) {
    for (const element of Array.from(worldRef.current?.querySelectorAll<HTMLElement>("article[data-node-id]") || [])) {
      element.style.removeProperty("transform");
      element.style.removeProperty("will-change");
    }
    value.edges.forEach((edge, index) => {
      const a = value.nodes.find(item => item.id === edge.from), b = value.nodes.find(item => item.id === edge.to);
      const path = worldRef.current?.querySelector<SVGPathElement>(`path[data-edge-index="${index}"]`);
      if (a && b && path) path.setAttribute("d", edgePath(a, b));
    });
  }
  async function appendSelectedScript(title: string, text: string, episode: number, modelId: string, requestId: string, generated: boolean) {
    if (!projectContext) throw new Error("请先打开一个制作项目");
    if (!demo && episode === activeEpisode && canvasSync !== "saved") throw new Error("当前分集画布尚未同步。先解决同步状态，再把剧本版本写入画布。");
    const source = generated ? "模型生成" : "人工录入";
    const task = await onSaveScript(projectContext.project.id, episode, text, source, generated ? modelId : undefined, generated ? requestId : undefined);
    const key = projectCanvasStorageKey(actorId, projectContext.project.id, episode);
    const raw = localStorage.getItem(key);
    const contextWithoutThisEpisode = { ...projectContext, tasks: projectContext.tasks.filter(item => item.episode !== episode) };
    let version = 0;
    let base: DraftGraph;
    if (!demo) {
      try {
        const response = await fetch(`/api/production-lab/canvas?projectId=${encodeURIComponent(projectContext.project.id)}&episode=${episode}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取服务器画布失败");
        version = Number(data.version || 0);
        base = data.graph || (episode === activeEpisode && raw ? JSON.parse(raw) : projectInitialGraph(contextWithoutThisEpisode, episode));
      } catch (error) {
        throw new Error(`剧本已保存为 v${task.version}，但读取服务器画布失败；请稍后从项目剧本中重试关联：${error instanceof Error ? error.message : "画布不可用"}`);
      }
    } else base = raw ? JSON.parse(raw) : projectInitialGraph(contextWithoutThisEpisode, episode);
    const flow = buildScriptStoryboardGraph(base, {
      project: projectContext.project, episode, taskId: task.id, version: task.version,
      title: task.title + " / v" + task.version + " · " + source, script: text,
      skillIds: skills.filter(id => ["编导", "制作"].includes(inventory.find(item => item.id === id)?.category || "")),
      viewport: viewportRef.current,
    });
    const next = flow.graph;
    if (!demo) {
      try {
        const response = await fetch("/api/production-lab/canvas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projectContext.project.id, episode, expectedVersion: version, graph: next }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "服务器画布保存失败");
        version = Number(data.version);
      } catch (error) {
        localStorage.setItem(projectCanvasRecoveryStorageKey(actorId, projectContext.project.id, episode), JSON.stringify({ savedAt: new Date().toISOString(), graph: next }));
        throw new Error(`剧本已保存为 v${task.version}，但画布关联写入失败；本机恢复副本已保留：${error instanceof Error ? error.message : "保存失败"}`);
      }
    }
    localStorage.setItem(key, JSON.stringify(next));
    if (episode === activeEpisode) {
      canvasVersion.current = version;
      loadedStorageKey.current = key;
      setPast(value => [...value.slice(-29), graph]); setFuture([]);
      setGraph(next); setReady(true); setSelected(flow.scriptNodeId); setSelectedIds([flow.scriptNodeId]);
      const node = next.nodes.find(item => item.id === flow.scriptNodeId)!;
      setViewport(v => ({ ...v, x: 50 - node.x * v.k, y: 120 - node.y * v.k }));
    }
    setActiveEpisode(episode); setTab("canvas");
  }

  return <div className={`${c.root} ${appearance === "light" ? c.light : ""}`}><header className={c.header}><button className={c.wordmark} onClick={() => setTab("canvas")}>fg<span>STUDIO</span><small>06</small></button><div className={c.projectCrumb}><span>制作实验室</span><ChevronRight size={13} /><strong>{projectContext?.project.title || "未选择项目"}</strong>{projectContext?.project.topicId && <span className={c.sample}>选题 #{projectContext.project.topicId}</span>}{projectContext && <span className={c.sample}>{projectContext.project.tier} 级 · {projectContext.project.stage}</span>}</div><div className={c.headerRight}><Button type="text" aria-label="切换明暗模式" disabled={!appearanceReady} onClick={toggleAppearance}>{appearance === "dark" ? "日间" : "夜间"}</Button><Button type="text" icon={<ArrowDownToLine size={15} />} onClick={() => exportGraph()}>导出</Button><span className={c.user}>FL</span></div></header>
    <div className={c.subheader}><nav><button className={tab === "canvas" ? c.active : ""} onClick={() => {setTab("canvas");setSkills(["seedance-director","acting"]);}}><Layers3 size={15} />制作画布</button><button className={tab === "scripts" ? c.active : ""} onClick={() => { setTab("scripts"); setSkills(["deepwhite-screenwriting-v1"]); }}><FileText size={15} />批量剧本</button><button className={tab === "assets" ? c.active : ""} onClick={() => setTab("assets")}><Box size={15} />素材库</button><button onClick={onManagement}><LayoutGrid size={15} />项目推进</button></nav></div>
    <div className={c.notice}><span>第六板块试用</span>项目、分集与服务器画布已关联；WeToken 图片 / 视频队列、NAS 团队素材库和 Reference ID 费用对账已接入。每次实际生成都会先展示估价并要求确认。<button onClick={() => setMobilePanel(v => !v)}>制作面板</button></div>
    <div className={c.workspace}><aside className={c.left}><div className={c.leftTitle}><span>项目内容</span><Layers3 size={14} /></div><button className={c.episode} onClick={() => fitGraph()}><Clapperboard size={16} /><div>EP {String(activeEpisode).padStart(2, "0")}<small>{projectContext?.tasks.find(task => task.episode === activeEpisode)?.title || (projectContext ? "暂无分集任务" : "先选择项目")}</small></div><span>{graph.nodes.length}</span></button>{projectContext && projectContext.tasks.length > 1 && <Select className={c.episodeSelect} size="small" aria-label="选择项目分集" value={activeEpisode} onChange={setActiveEpisode} options={projectContext.tasks.map(task => ({ value: task.episode, label: task.title + " · " + task.status }))} />}<div className={c.label}>素材与节点</div>{Object.entries(kindLabels).map(([key, label]) => { const Icon = icons[key as DraftKind]; return <div key={key}><button className={c.folder} onClick={() => add(key as DraftKind)}><Icon size={14} /><span>{label}</span><Plus size={12} /></button>{graph.nodes.filter(n => n.kind === key).map(n => <button key={n.id} className={`${c.asset} ${selected === n.id ? c.selectedAsset : ""}`} onClick={() => { select(n.id); animateViewport({ ...viewportRef.current, x: 70 - n.x * viewportRef.current.k, y: 135 - n.y * viewportRef.current.k }); }}>{n.title}</button>)}</div>; })}<div className={c.leftFoot}><span>生产工作流</span><strong>选题 → 剧本 → 分镜 → 视频</strong><small>同一项目与分集上下文</small></div></aside>
    {tab === "canvas" ? <section className={`${c.canvas} ${isPanning ? c.panning : ""}`} ref={boardRef} tabIndex={0} onKeyDown={handleCanvasKeyDown} onKeyUp={event => { if (event.code === "Space") spaceHeld.current = false; }} onBlur={() => { spaceHeld.current = false; }} onPointerDown={event => {
      if (event.target !== event.currentTarget) return;
      event.currentTarget.focus({ preventScroll: true });
      cancelAnimationFrame(motionFrame.current);
      viewportTargetRef.current = viewportRef.current;
      velocity.current = { x: 0, y: 0, time: performance.now(), px: event.clientX, py: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, nx: viewportRef.current.x, ny: viewportRef.current.y, before: graph, moved: false, marquee: event.shiftKey };
      if (event.shiftKey) {
        const rect = event.currentTarget.getBoundingClientRect();
        setMarquee({ x: event.clientX - rect.left, y: event.clientY - rect.top, width: 0, height: 0 });
      } else { setSelected(undefined); setSelectedIds([]); setIsPanning(true); }
    }} onPointerMove={event => {
      const current = drag.current; if (!current) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      current.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
      if (current.marquee) {
        const board = boardRef.current?.getBoundingClientRect();
        if (!board) return;
        const x = Math.min(event.clientX - board.left, current.x - board.left), y = Math.min(event.clientY - board.top, current.y - board.top);
        const width = Math.abs(dx), height = Math.abs(dy);
        setMarquee({ x, y, width, height });
        const left = board.left + x, top = board.top + y, right = left + width, bottom = top + height;
        const ids = Array.from(worldRef.current?.querySelectorAll<HTMLElement>("article[data-node-id]") || []).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        }).map(element => element.dataset.nodeId!).filter(Boolean);
        setSelectedIds(ids); setSelected(ids.at(-1));
      } else if (current.id) {
        const origins = current.origins || [{ id: current.id, x: current.nx, y: current.ny }];
        current.dx = dx; current.dy = dy;
        paintNodeDragPreview(origins, dx, dy);
      } else {
        const now = performance.now(), dt = Math.max(1, now - velocity.current.time);
        velocity.current = { x: (event.clientX - velocity.current.px) / dt, y: (event.clientY - velocity.current.py) / dt, time: now, px: event.clientX, py: event.clientY };
        const nextView = { ...viewportRef.current, x: current.nx + dx, y: current.ny + dy };
        viewportTargetRef.current = nextView;
        writeViewport(nextView);
      }
    }} onPointerUp={() => {
      const current = drag.current;
      if ((current?.id && current.moved) || current?.duplicated) { setPast(value => [...value.slice(-29), current.before]); setFuture([]); }
      if (current?.id && current.moved) {
        const origins = current.origins || [{ id: current.id, x: current.nx, y: current.ny }];
        const worldDx = (current.dx || 0) / viewportRef.current.k, worldDy = (current.dy || 0) / viewportRef.current.k;
        clearNodeDragPreview(graph);
        setGraph(value => ({ ...value, nodes: value.nodes.map(item => { const origin = origins.find(point => point.id === item.id); return origin ? { ...item, x: origin.x + worldDx, y: origin.y + worldDy } : item; }) }));
      }
      if (current?.marquee) setMarquee(undefined);
      setIsPanning(false);
      if (current && !current.id && !current.marquee && current.moved && inertia && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && performance.now() - velocity.current.time < 90) {
        let vx = Math.max(-1.8, Math.min(1.8, velocity.current.x * 1000));
        let vy = Math.max(-1.8, Math.min(1.8, velocity.current.y * 1000));
        let previous = performance.now();
        viewportTargetRef.current = viewportRef.current;
        const tick = (now: number) => {
          const elapsed = Math.min(32, now - previous); previous = now;
          const currentView = viewportRef.current;
          const nextView = { ...currentView, x: currentView.x + vx * elapsed / 1000, y: currentView.y + vy * elapsed / 1000 };
          viewportTargetRef.current = nextView;
          writeViewport(nextView);
          const friction = Math.exp(-elapsed / 245);
          vx *= friction; vy *= friction;
          if (Math.hypot(vx, vy) < 0.035) { publishViewport(); return; }
          motionFrame.current = requestAnimationFrame(tick);
        };
        motionFrame.current = requestAnimationFrame(tick);
      } else if (current && !current.id && !current.marquee) publishViewport();
      drag.current = undefined;
    }} onPointerCancel={() => {
      const current = drag.current;
      if (current?.id) { clearNodeDragPreview(graph); if (current.duplicated) setGraph(current.before); }
      drag.current = undefined; setMarquee(undefined); setIsPanning(false); cancelAnimationFrame(motionFrame.current);
    }} onDoubleClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      add("text", { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }}>
      {!projectContext && <div className={c.noProject}><strong>{projectError || "先选择一个制作项目"}</strong><p>选题、分集任务、剧本审核和画布草稿会共用同一个项目。</p><Button type="primary" onClick={onManagement}>打开项目与进度</Button></div>}<div className={c.canvasTitle}><span>STORY PRODUCTION · {projectContext ? `EP ${String(activeEpisode).padStart(2, "0")}` : "NEW BOARD"}</span><h1>{projectContext?.project.title || "制作画布"}</h1><small>拖动节点移动 · 空白处平移 · Shift + 拖动框选 · Ctrl/Cmd + 滚轮缩放</small><button className={c.shortcutHelp} onClick={() => setShortcutsOpen(true)}><Keyboard size={12} /> 快捷键</button></div>{selectedIds.length > 0 && <div className={c.selectionBar} role="toolbar" aria-label="已选节点操作"><span><MousePointer2 size={14} /> 已选 {selectedIds.length} 个节点</span><Button aria-label="复制选中节点" type="text" icon={<Copy size={14} />} onClick={copySelection}>复制</Button><Button aria-label="创建选中节点副本" type="text" icon={<Plus size={14} />} onClick={duplicateSelection}>创建副本</Button><Button aria-label="删除选中节点" type="text" danger icon={<Trash2 size={14} />} onClick={deleteSelection}>删除</Button><button aria-label="清除选择" title="清除选择" onClick={() => { setSelected(undefined); setSelectedIds([]); }}><X size={14} /></button></div>}<div ref={worldRef} className={c.world} style={{ transform: `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.k})` }}><svg className={c.edges}>{graph.edges.map((edge, i) => { const a = graph.nodes.find(n => n.id === edge.from), b = graph.nodes.find(n => n.id === edge.to); return a && b && <path key={i} data-edge-index={i} d={edgePath(a, b)} />; })}</svg>{graph.nodes.map(n => { const Icon = icons[n.kind]; return <article key={n.id} data-node-id={n.id} className={[c.node, selectedIds.includes(n.id) ? c.selected : ""].filter(Boolean).join(" ")} style={{ left: n.x, top: n.y }} onPointerDown={event => {
        const target = event.target as HTMLElement;
        if (target.closest("button")) return;
        event.stopPropagation();
        if (spaceHeld.current && boardRef.current) {
          boardRef.current.setPointerCapture(event.pointerId);
          setIsPanning(true);
          velocity.current = { x: 0, y: 0, time: performance.now(), px: event.clientX, py: event.clientY };
          drag.current = { x: event.clientX, y: event.clientY, nx: viewportRef.current.x, ny: viewportRef.current.y, before: graph, moved: false };
          return;
        }
        if (target.closest(`.${c.nodeBody}`)) {
          select(n.id, event.shiftKey);
          return;
        }
        boardRef.current?.focus({ preventScroll: true });
        const nextIds = event.shiftKey ? selectedIds.includes(n.id) ? selectedIds.filter(id => id !== n.id) : [...selectedIds, n.id] : selectedIds.includes(n.id) ? selectedIds : [n.id];
        let targetId = n.id, working = graph;
        if (event.altKey) {
          const duplicate = { ...structuredClone(n), id: crypto.randomUUID() };
          working = applyDraft(graph, [{ type: "add", node: duplicate }]);
          setGraph(working); targetId = duplicate.id;
          setSelected(targetId); setSelectedIds([targetId]);
        } else {
          select(n.id, event.shiftKey);
        }
        const movingIds = event.altKey ? [targetId] : nextIds.includes(n.id) ? nextIds : [n.id];
        const origins = working.nodes.filter(item => movingIds.includes(item.id)).map(item => ({ id: item.id, x: item.x, y: item.y }));
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: targetId, ids: movingIds, origins, x: event.clientX, y: event.clientY, nx: n.x, ny: n.y, before: graph, moved: false, duplicated: event.altKey };
      }}><div className={c.nodeHead}><Icon size={14} /><span>{kindLabels[n.kind]}</span><small>{n.assetId ? "云端素材" : "草稿"}</small></div><div className={`${c.nodeBody} ${c[n.kind]}`}><div className={c.nodeIndex}>{n.kind === "character" ? "CHARACTER" : n.kind === "scene" ? "ENVIRONMENT" : n.kind === "shot" ? "SHOT DESIGN" : n.kind === "video" ? "MOTION" : n.kind === "audio" ? "SOUND" : "SCREENPLAY"}</div><h2>{n.title}</h2>{n.assetId && <CanvasAssetPicture id={n.assetId} kind={n.assetKind}/>}
{!n.assetId && ["character", "scene", "video", "audio"].includes(n.kind) && <div className={c.mediaEmpty}><Icon size={35} strokeWidth={.8} /><span>{n.kind === "video" ? "等待真实生成" : "素材待加入"}</span></div>}<p>{n.text || "点击后在右侧补充内容"}</p></div><div className={c.nodeFoot}>{n.skillIds.length ? `${n.skillIds.length} 个 Skill 已选择` : "尚未选择 Skill"}<span>{n.metadata?.topicId ? `选题 #${n.metadata.topicId} · EP${String(n.metadata.episode || 1).padStart(2, "0")}` : n.metadata?.episode ? `EP${String(n.metadata.episode).padStart(2, "0")}` : "草稿"}</span></div><i className={c.portIn} /><button className={c.portOut} aria-label={`从${n.title}连线`} onClick={e => { e.stopPropagation(); setConnecting(n.id); message.info("选择目标节点完成连线"); }} /></article>; })}</div>
      {marquee && <div aria-hidden className={c.marquee} style={marquee} />}
      {connecting && <div className={c.connectHint}>选择目标节点连接 <button onClick={() => setConnecting(undefined)}>取消</button></div>}
      <div ref={dockRef} className={c.dock} style={{ "--dock-x": `${dockOffset.x}px`, "--dock-y": `${dockOffset.y}px` } as React.CSSProperties} onPointerMove={moveDock} onPointerUp={endDockDrag} onPointerCancel={endDockDrag} onPointerDown={event => event.stopPropagation()}><button className={c.dockHandle} type="button" aria-label="拖动画布工具栏；也可用方向键微调" title="按住拖动；方向键微调，Shift 加速" onPointerDown={beginDockDrag} onKeyDown={nudgeDock}><GripVertical size={15} /></button><Tooltip title="添加文本"><Button aria-label="添加文本节点" type="text" icon={<FileText size={17} />} onClick={() => add("text")} /></Tooltip><Tooltip title="角色资产"><Button aria-label="添加角色节点" type="text" icon={<Users size={17} />} onClick={() => add("character")} /></Tooltip><Tooltip title="场景资产"><Button aria-label="添加场景节点" type="text" icon={<ImageIcon size={17} />} onClick={() => add("scene")} /></Tooltip><Tooltip title="镜头"><Button aria-label="添加镜头节点" type="text" icon={<Clapperboard size={17} />} onClick={() => add("shot")} /></Tooltip><Tooltip title="视频任务"><Button aria-label="添加视频节点" type="text" icon={<Film size={17} />} onClick={() => add("video")} /></Tooltip><Tooltip title="声音"><Button aria-label="添加声音节点" type="text" icon={<AudioLines size={17} />} onClick={() => add("audio")} /></Tooltip><i /><Tooltip title="排队生成图片或视频"><Button aria-label="打开图片视频生成队列" type="text" icon={<WandSparkles size={17} />} disabled={!projectContext || demo} onClick={() => setMediaOpen(true)} /></Tooltip><Tooltip title="按节点依赖自动排布"><Button aria-label="自动排布" type="text" icon={<LayoutGrid size={16} />} onClick={arrangeGraph} /></Tooltip><Button aria-label="撤销" type="text" disabled={!past.length} icon={<Undo2 size={16} />} onClick={undo} /><Button aria-label="重做" type="text" disabled={!future.length} icon={<Redo2 size={16} />} onClick={redo} /></div><div className={c.zoom}><button aria-label="缩小" onClick={() => { const rect = boardRef.current?.getBoundingClientRect(); if (rect) animateViewport(zoomAtPoint(viewportTargetRef.current, { x: rect.width / 2, y: rect.height / 2 }, 110)); }}><Minus size={14} /></button><span>{Math.round(viewport.k * 100)}%</span><button aria-label="放大" onClick={() => { const rect = boardRef.current?.getBoundingClientRect(); if (rect) animateViewport(zoomAtPoint(viewportTargetRef.current, { x: rect.width / 2, y: rect.height / 2 }, -110)); }}><Plus size={14} /></button><button aria-label="适配画布内容" title="适配画布内容" onClick={() => fitGraph()}><Focus size={14} /></button></div>
    <div className={c.minimap} role="button" tabIndex={0} aria-label="画布小地图，点击可定位画布" onPointerDown={event => { event.stopPropagation(); navigateMinimap(event); }} title="点击定位画布">
      <small>画布地图</small><div className={c.minimapWorld} style={{ width: mapWidth, height: mapHeight }}>{graph.nodes.map(item => <span key={item.id} className={selectedIds.includes(item.id) ? c.mapNodeSelected : c.mapNode} title={item.title} style={{ left: (item.x - mapBounds.minX) * mapScale, top: (item.y - mapBounds.minY) * mapScale }} />)}</div>
    </div>
    <Modal title="画布快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} width={480}><div className={c.shortcutList}>
      <p><kbd>双击空白</kbd><span>在光标位置新建剧本节点</span></p>
      <p><kbd>Tab</kbd><span>新建一个剧本节点</span></p>
      <p><kbd>空格 + 拖动</kbd><span>移动画布；直接拖动空白处也可平移</span></p>
      <p><kbd>Shift + 拖动</kbd><span>框选多个节点，可复制、移动或删除</span></p>
      <p><kbd>Ctrl/Cmd + 滚轮</kbd><span>以光标位置缩放，不放大浏览器</span></p>
      <p><kbd>Shift + 滚轮</kbd><span>横向移动画布</span></p>
      <p><kbd>Alt + 拖动</kbd><span>复制并移动节点</span></p>
      <p><kbd>Ctrl/Cmd + L</kbd><span>从选中节点开始连线，再点目标节点</span></p>
      <p><kbd>Shift + 点击</kbd><span>增加或移除多选节点</span></p>
      <p><kbd>Ctrl/Cmd + C / V</kbd><span>在当前画布复制节点与节点间连线</span></p>
      <p><kbd>Delete / Backspace</kbd><span>删除选中节点及相关连线</span></p>
      <p><kbd>Ctrl/Cmd + Z</kbd><span>撤销</span></p>
      <p><kbd>Ctrl/Cmd + Shift + Z · Y</kbd><span>重做</span></p>
      <p><kbd>Ctrl/Cmd + 0</kbd><span>适配当前画布内容</span></p>
    </div><p className={c.helper}>快捷键不会干扰输入框。媒体生成需单独确认费用预估；WeToken Reference ID 会进入费用对账，成片写入团队云端素材库。</p></Modal></section> : tab === "assets" ? <AssetLibrary demo={demo} projectId={projectContext?.project.id} episode={activeEpisode} projectName={projectContext?.project.title || "未选择项目"} onUse={asset => { const nodeKind: DraftKind = asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : asset.category === "场景" ? "scene" : "character"; const n = createDraft(nodeKind, asset.name, asset.text, 100, Math.max(100,...graph.nodes.map(n=>n.y+NODE_ESTIMATED_HEIGHT)), ["deepwhite-image-prompt-builder"]); n.assetId = asset.id; n.assetKind = asset.kind; commit([{type:"add",node:n}]); setTab("canvas"); setSelected(n.id); setSelectedIds([n.id]); setViewport(v=>({...v,x:50-n.x*v.k,y:70-n.y*v.k})); }} /> : projectContext ? <ScriptComparison project={projectContext.project} projectTasks={projectContext.tasks} actorId={actorId} demo={demo} skillIds={skills.filter(id=>inventory.find(s=>s.id===id)?.category==="编导")} onSkills={()=>{setSkillCategory("编导");setSkillOpen(true);}} onPrepareBatch={onPrepareBatch} onUse={appendSelectedScript} /> : <section className={c.noProject}><Empty description="请先在项目推进中打开一个制作项目"><Button type="primary" onClick={onManagement}>打开项目与进度</Button></Empty></section>}

      <aside style={tab !== "canvas" ? { display: "none" } : undefined} className={`${c.right} ${mobilePanel ? c.showPanel : ""}`}><div className={c.assistantHeader}><span className={c.assistantIcon}><Focus size={16} /></span><div><strong>画布上下文</strong><small>{selectedIds.length > 1 ? `已多选 ${selectedIds.length} 个节点` : node ? `选中：${kindLabels[node.kind]} · ${node.title}` : "项目依据 · 分集内容 · 上游素材"}</small></div><button aria-label="关闭制作面板" onClick={() => setMobilePanel(false)} className={c.closePanel}><X size={15} /></button></div><div className={c.rightBody}>{node && tab === "canvas" ? <div className={c.inspector}><div className={c.label}>选中节点 / {kindLabels[node.kind]}</div><Input aria-label="节点名称" value={node.title} onFocus={() => { editBefore.current = graph; }} onBlur={finishInspectorEdit} onChange={e => setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === node.id ? { ...n, title: e.target.value } : n) }))} /><Input.TextArea aria-label="节点内容" value={node.text} rows={4} onFocus={() => { editBefore.current = graph; }} onBlur={finishInspectorEdit} onChange={e => setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === node.id ? { ...n, text: e.target.value } : n) }))} /><div className={c.inspectorActions}><Button size="small" icon={<Link2 size={12} />} onClick={() => setConnecting(node.id)}>作为引用来源</Button><Button size="small" danger icon={<Trash2 size={12} />} onClick={() => { if (commit([{ type: "delete", ids: [node.id] }])) { setSelected(undefined); setSelectedIds([]); } }}>删除</Button></div></div> : null}{projectContext ? <ProductionAgent demo={demo} appearance={appearance} actorId={actorId} project={projectContext.project} episode={activeEpisode} task={projectContext.tasks.find(task=>task.episode===activeEpisode)} selectedNode={node} graph={graph} canvasSync={canvasSync} skillIds={skills} skillLabels={skills.map(id=>skillName[id]||id)} onSkills={()=>{setSkillCategory("全部");setSkillOpen(true);}} onOpenMedia={() => setMediaOpen(true)} onApply={applyAgentOperations} /> : <div className={c.emptyPlan}><Layers3 size={20}/><p>先打开制作项目</p><Button type="primary" onClick={onManagement}>项目与进度</Button></div>}

      <div className={c.planArea}><div className={c.label}>生成队列</div><p className={c.helper}>图片同步生成，视频由 WeToken 异步排队。任务、实际费用和云端素材均关联当前项目与分集。</p></div>{events.length > 0 && <div className={c.events}>{events.slice(0,3).map((e,i) => <p key={i}><Check size={12}/>{e}</p>)}</div>}</div>
    </aside></div><footer className={c.statusbar}><span><i/>{demo ? "本机画布预览" : canvasSync === "saved" ? "项目画布已同步" : canvasSync === "saving" ? "画布保存中" : canvasSync === "conflict" ? "多人冲突 · 已保留本机副本" : canvasSync === "error" ? "同步失败 · 本机副本保留" : "读取画布中"}</span><span>{graph.nodes.length} 个节点 · {graph.edges.length} 条连线{selectedIds.length > 1 ? ` · 已选 ${selectedIds.length}` : ""}</span><button className={c.physicsToggle} onClick={()=>{cancelAnimationFrame(motionFrame.current);setInertia(v=>!v);}}>惯性平移：{inertia?"开":"关"}</button>{!demo && (canvasSync === "error" || canvasSync === "conflict") && <><Button size="small" onClick={() => exportGraph()}>下载本机副本</Button>{canvasSync === "conflict" ? <Button size="small" onClick={loadServerCanvas}>载入服务器版本</Button> : <Button size="small" onClick={retryCanvasSync}>重试同步</Button>}</>}<span>WeToken 图片 / 视频队列 · Reference ID 费用对账</span></footer>
    <Drawer title={`制作 Skills / ${inventory.length} 个`} open={skillOpen} onClose={() => setSkillOpen(false)} width={640}><p className={c.helper}>按任务选择少量技能组合。只展示漫剧编导、美术和制作技能。4 个编导 Skill、5 个制作视觉 Skill 已打包到新运行器；其他技能保留分类信息，但尚未适配执行。</p><Input prefix={<Search size={14}/>} placeholder="搜索技能名称或说明" value={skillQuery} onChange={e => setSkillQuery(e.target.value)}/><div className={c.skillFilters}>{["全部","编导","美术","制作"].map(k => <Button key={k} size="small" type={skillCategory === k ? "primary" : "default"} onClick={() => setSkillCategory(k)}>{k}</Button>)}</div>{inventory.filter(s => (skillCategory === "全部" || s.category === skillCategory) && `${s.name} ${s.description} ${skillName[s.id]}`.toLowerCase().includes(skillQuery.toLowerCase())).map(s => <div key={s.id} className={c.skillRow}><div><Tag>{s.category}</Tag><strong>{skillName[s.id] || s.name}</strong><code>{s.id}</code><p>{s.description.slice(0,180)}</p><small>{s.status} · {s.hasReferences ? "含附属资料" : "单文件技能"}</small></div><Button size="small" disabled={s.status === "尚未适配运行器" || !["编导", "美术", "制作"].includes(s.category)} type={skills.includes(s.id) ? "primary" : "default"} onClick={() => setSkills(v => { if (v.includes(s.id)) return v.filter(x => x !== s.id); if (v.length >= 2) { message.info("每次最多选择两个制作 Skill"); return v; } return [...v,s.id]; })}>{skills.includes(s.id) ? "已选择" : s.status === "尚未适配运行器" ? "待接入" : !["编导", "美术", "制作"].includes(s.category) ? "其他工作区" : "选择"}</Button></div>)}</Drawer>
    <ProductionMediaQueue open={mediaOpen} onClose={() => setMediaOpen(false)} demo={Boolean(demo)} project={projectContext?.project || null} episode={activeEpisode} task={projectContext?.tasks.find(item => item.episode === activeEpisode)} selectedNode={graph.nodes.find(item => item.id === selected)} appearance={appearance} onUseAsset={asset => { const nodeKind: DraftKind = asset.targetKind || (asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : asset.category === "场景" ? "scene" : "character"); const n = createDraft(nodeKind, asset.name, asset.text, 100, Math.max(100, ...graph.nodes.map(item => item.y + NODE_ESTIMATED_HEIGHT)), [nodeKind === "video" ? "seedance-director" : "deepwhite-image-prompt-builder"]); n.assetId = asset.id; n.assetKind = asset.kind; commit([{ type: "add", node: n }]); setTab("canvas"); setSelected(n.id); setSelectedIds([n.id]); setViewport(value => ({ ...value, x: 50 - n.x * value.k, y: 70 - n.y * value.k })); setMediaOpen(false); }} />
  </div>;
}
