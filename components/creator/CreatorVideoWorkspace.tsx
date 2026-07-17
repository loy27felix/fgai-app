"use client";

import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { Hov, Icon, useFgTheme } from "@/components/studio/ui";
import CreatorVideoNodeCanvas, { creatorVideoReferenceKey, type CreatorVideoCanvasGenerateInput, type CreatorVideoCanvasGraph, type VideoPreview } from "@/components/creator/CreatorVideoNodeCanvas";
import { createClient } from "@/lib/supabase/client";
import type { CreatorCanvas, CreatorVideoTask, CreatorVideoTaskView } from "@/lib/creator/types";
import { createCreatorCanvas, deleteCreatorCanvas, listCreatorCanvases, updateCreatorCanvas } from "@/lib/creator/canvas-client";
import { confirmVideoTask, createVideoDraft, deleteVideoTask, finalizeVideoUploads, getVideoTask, listVideoTasks, CreatorImageClientError } from "@/lib/creator/video-client";
import { validateVideoDraftInput, type CreatorVideoSkill, type VideoReferenceKind, type VideoReferenceManifest, type VideoReferenceRole } from "@/lib/creator/video";
import { VIDEO_MODELS, getVideoModel } from "@/lib/ai/video-models";

type Props = { userEmail: string };
type Phase = "idle" | "preparing" | "confirming" | "error" | "unknown";
type FileEntry = { file: File; kind: VideoReferenceKind; role: VideoReferenceRole };
const PANEL_MIN = 330;
const PANEL_MAX = 590;
const PANEL_DEFAULT = 430;
const DURATION_MIN = 4;
const DURATION_MAX = 15;
const DEFAULT_DURATION = 5;
const RATIOS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const I = {
  chat: ["M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"],
  image: ["M4 4h16v16H4z", "m4 16 4-4 3 3 4-5 5 6", "M9 9h.01"],
  video: ["M3 5h14v14H3z", "m17 9 4-2v10l-4-2"],
  plus: ["M12 5v14M5 12h14"],
  back: ["m15 18-6-6 6-6"],
  refresh: ["M20 11a8.1 8.1 0 0 0-15.4-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.4 2M20 19v-4h-4"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  trash: ["M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"],
  download: ["M12 4v11", "m7 11 5 5 5-5", "M5 20h14"],
  copy: ["M8 8h11v12H8z", "M5 16H4V4h12v1"],
  spark: ["M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z"],
  close: ["M6 6l12 12M18 6 6 18"],
  expand: ["M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6"],
  check: ["M5 13l4 4L19 7"],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function statusLabel(status: CreatorVideoTask["status"]) {
  return ({ draft: "草稿", submitting: "提交中", queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", expired: "已过期", unknown: "状态未知" } as Record<string, string>)[status] || status;
}
function dateLabel(value: string) {
  try { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; }
}
function promptOf(task: CreatorVideoTask | CreatorVideoTaskView) {
  return typeof record(task.request).prompt === "string" ? String(record(task.request).prompt) : "";
}
function skillOf(task: CreatorVideoTask | CreatorVideoTaskView): CreatorVideoSkill | null {
  const skill = record(record(task.request).skill);
  return typeof skill.name === "string" && typeof skill.content === "string" ? { name: skill.name, content: skill.content } : null;
}
function keyFor(file: File) { return [file.name, file.size, file.lastModified].join(":"); }
function kindFor(file: File): VideoReferenceKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}
function defaultRole(kind: VideoReferenceKind): VideoReferenceRole {
  return kind === "video" ? "reference_video" : kind === "audio" ? "reference_audio" : "reference_image";
}
function roleOptions(kind: VideoReferenceKind) {
  return kind === "video" ? [{ value: "reference_video", label: "视频参考" }] : kind === "audio" ? [{ value: "reference_audio", label: "音频参考" }] : [{ value: "reference_image", label: "普通参考" }, { value: "first_frame", label: "首帧" }, { value: "last_frame", label: "尾帧" }];
}
function graphOf(canvas: CreatorCanvas | null): CreatorVideoCanvasGraph | null {
  if (!canvas?.graph || !Array.isArray(canvas.graph.nodes) || !Array.isArray(canvas.graph.edges)) return null;
  return { nodes: canvas.graph.nodes as CreatorVideoCanvasGraph["nodes"], edges: canvas.graph.edges as CreatorVideoCanvasGraph["edges"] };
}
function graphPrompt(graph: CreatorVideoCanvasGraph | null) {
  return graph?.nodes.filter((node) => node.kind === "prompt").map((node) => typeof node.text === "string" ? node.text.trim() : "").filter(Boolean).join("\n") || "";
}
function saveGraph(graph: CreatorVideoCanvasGraph): CreatorVideoCanvasGraph {
  return { nodes: graph.nodes.map((node) => ({ ...node, url: node.kind === "ref" ? null : node.url || null, busy: false })), edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to })) };
}
function errorText(error: unknown, fallback: string) { return error instanceof CreatorImageClientError ? error.message : fallback; }
function newKey() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "creator-video-" + Date.now(); }

export default function CreatorVideoWorkspace({ userEmail }: Props) {
  const { theme, toggle } = useFgTheme();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;
  const [model, setModel] = useState(VIDEO_MODELS[0].id);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [watermark, setWatermark] = useState(true);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [previews, setPreviews] = useState<VideoPreview[]>([]);
  const [skill, setSkill] = useState<CreatorVideoSkill | null>(null);
  const [tasks, setTasks] = useState<CreatorVideoTaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CreatorVideoTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CreatorVideoTaskView | null>(null);
  const [canvases, setCanvases] = useState<CreatorCanvas[]>([]);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [graph, setGraph] = useState<CreatorVideoCanvasGraph | null>(null);
  const [canvasDeleteTarget, setCanvasDeleteTarget] = useState<CreatorCanvas | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [canvasDeleting, setCanvasDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const saveTimerRef = useRef<number | null>(null);
  const resizeRef = useRef<{ x: number; width: number } | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const activeModel = getVideoModel(model);
  const me = userEmail.replace(/@.*/, "").slice(0, 2).toUpperCase();

  function checkFiles(next: FileEntry[]) {
    try {
      validateVideoDraftInput({
        prompt: prompt.trim() || "placeholder",
        model,
        references: next.map((entry) => ({ name: entry.file.name, mimeType: entry.file.type, size: entry.file.size, kind: entry.kind, role: entry.role })),
        duration, ratio, resolution, watermark, generateAudio, skill,
      });
      return null;
    } catch (value) { return value instanceof Error ? value.message : "参考素材参数无效"; }
  }
  function addFiles(incoming: File[]) {
    const next = [...files];
    for (const file of incoming) {
      if (next.some((entry) => keyFor(entry.file) === keyFor(file))) continue;
      const kind = kindFor(file);
      next.push({ file, kind, role: defaultRole(kind) });
    }
    const issue = checkFiles(next);
    if (issue) { setError(issue); setPhase("error"); return false; }
    setFiles(next); setError(""); setNotice(""); return true;
  }
  function changeFile(event: ChangeEvent<HTMLInputElement>) { addFiles(Array.from(event.target.files || [])); event.target.value = ""; }
  function updateRole(index: number, role: VideoReferenceRole) { setFiles((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, role } : entry)); }
  function removeFile(index: number) { setFiles((current) => current.filter((_, item) => item !== index)); }
  function selectCanvas(canvas: CreatorCanvas) {
    const next = graphOf(canvas);
    setSelectedCanvasId(canvas.id); setGraph(next); setPrompt(graphPrompt(next)); setFiles([]); setSkill(null); setConfirmTarget(null); setSelectedTaskId(null); setPhase("idle"); setError(""); setNotice("");
  }
  async function loadCanvases(prefer?: string) {
    setCanvasLoading(true);
    try {
      let next = (await listCreatorCanvases("video")).canvases || [];
      if (!next.length) next = [(await createCreatorCanvas({ title: "新视频画布" }, "video")).canvas];
      const target = next.find((item) => item.id === prefer) || next.find((item) => item.id === selectedCanvasId) || next[0];
      setCanvases(next); if (target) selectCanvas(target);
    } catch (value) { setNotice(errorText(value, "视频画布读取失败")); } finally { setCanvasLoading(false); }
  }
  async function newCanvas() {
    try { const result = await createCreatorCanvas({ title: "新视频画布" }, "video"); setCanvases((current) => [result.canvas, ...current]); selectCanvas(result.canvas); setNotice("已新建视频画布；生成记录不会自动带入"); }
    catch (value) { setError(errorText(value, "新建视频画布失败")); setPhase("error"); }
  }
  function onGraphChange(next: CreatorVideoCanvasGraph) {
    const persisted = saveGraph(next); setGraph(persisted);
    if (!selectedCanvasId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void updateCreatorCanvas(selectedCanvasId, { graph: persisted }).then((result) => setCanvases((current) => current.map((item) => item.id === result.canvas.id ? result.canvas : item))).catch(() => setNotice("画布已在本地更新，云端保存稍后重试")), 700);
  }
  async function removeCanvas() {
    if (!canvasDeleteTarget || canvasDeleting) return;
    const target = canvasDeleteTarget; setCanvasDeleting(true);
    try {
      await deleteCreatorCanvas(target.id);
      const remaining = canvases.filter((item) => item.id !== target.id); setCanvases(remaining); setCanvasDeleteTarget(null);
      if (selectedCanvasId === target.id) { if (remaining[0]) selectCanvas(remaining[0]); else { setSelectedCanvasId(null); setGraph(null); setPrompt(""); } }
      setNotice("视频画布已删除；任务和费用账本保持不变");
    } catch (value) { setError(errorText(value, "视频画布删除失败")); setPhase("error"); } finally { setCanvasDeleting(false); }
  }
  async function loadHistory(prefer?: string) {
    setHistoryLoading(true);
    try {
      const next = (await listVideoTasks()).tasks || [];
      const id = prefer && next.some((item) => item.id === prefer) ? prefer : selectedTaskId && next.some((item) => item.id === selectedTaskId) ? selectedTaskId : next[0]?.id || null;
      setTasks(next); setSelectedTaskId(id);
      const target = next.find((item) => item.id === id);
      setConfirmTarget(target && target.status === "draft" && record(target.request).uploads_complete === true ? target : null);
    } catch (value) { setError(errorText(value, "视频历史加载失败")); setPhase("error"); } finally { setHistoryLoading(false); }
  }
  function clearComposer() { setPrompt(""); setFiles([]); setSkill(null); setConfirmTarget(null); setSelectedTaskId(null); setPhase("idle"); setError(""); setNotice(""); }
  async function prepareDraft(input?: CreatorVideoCanvasGenerateInput) {
    if (phase === "preparing" || phase === "confirming" || confirmTarget) return;
    const refs = input?.references || files.map((entry) => ({ key: keyFor(entry.file), kind: entry.kind, role: entry.role }));
    const byKey = new Map(files.map((entry) => [keyFor(entry.file), entry]));
    const chosen = refs.map((item) => { const entry = byKey.get(item.key); return entry ? { ...entry, kind: item.kind, role: item.role } : null; }).filter((item): item is FileEntry => Boolean(item));
    const manifests: VideoReferenceManifest[] = chosen.map(({ file, kind, role }) => ({ name: file.name, mimeType: file.type, size: file.size, kind, role }));
    const draftPrompt = (input?.prompt || prompt).trim();
    try { validateVideoDraftInput({ prompt: draftPrompt, model, references: manifests, duration, ratio, resolution, watermark, generateAudio, skill }); }
    catch (value) { setError(value instanceof Error ? value.message : "视频提示词无效"); setPhase("error"); return; }
    setPhase("preparing"); setError(""); setNotice("");
    try {
      const draft = await createVideoDraft({ canvasId: selectedCanvasId, nodeId: input?.nodeId || null, prompt: draftPrompt, model, references: manifests, duration, ratio, resolution, watermark, generateAudio, skill, idempotencyKey: newKey() });
      if (draft.uploadPaths.length !== chosen.length) throw new Error("upload plan mismatch");
      for (let index = 0; index < chosen.length; index += 1) {
        const upload = await supabase.storage.from("creator-assets").upload(draft.uploadPaths[index], chosen[index].file, { upsert: false, contentType: chosen[index].file.type });
        if (upload.error) throw upload.error;
      }
      const ready = await finalizeVideoUploads(draft.task.id, draft.uploadPaths);
      const view: CreatorVideoTaskView = { ...ready.task, videoUrl: null, referenceUrls: [] };
      setTasks((current) => [view, ...current.filter((item) => item.id !== view.id)]);
      setSelectedTaskId(view.id); setConfirmTarget(ready.task); setPhase("idle"); setNotice("草稿已准备好；确认卡出现后才会调用视频服务");
    } catch (value) { setError(errorText(value, "视频草稿准备失败，参考素材未完成上传")); setPhase("error"); }
  }
  async function confirmTask() {
    if (!confirmTarget || phase === "confirming") return;
    const target = confirmTarget; setPhase("confirming"); setError("");
    try { const result = await confirmVideoTask(target.id); setConfirmTarget(null); if (result.task) setTasks((current) => [result.task as CreatorVideoTaskView, ...current.filter((item) => item.id !== target.id)]); setNotice("视频任务已提交，状态会自动轮询"); await loadHistory(target.id); }
    catch (value) { setConfirmTarget(null); if (value instanceof CreatorImageClientError && (value.status === 503 || value.status === 0)) { setPhase("unknown"); setNotice("提交结果可能未知；这次不会自动重试，请刷新状态"); await loadHistory(target.id); } else { setPhase("error"); setError(errorText(value, "视频确认失败")); } }
  }
  async function pollTask() {
    if (!selectedTask || !["submitting", "queued", "running", "unknown"].includes(selectedTask.status)) return;
    try { const result = await getVideoTask(selectedTask.id); setTasks((current) => current.map((item) => item.id === result.task.id ? result.task : item)); if (["succeeded", "failed", "expired"].includes(result.task.status)) setPhase("idle"); }
    catch (value) { setNotice(errorText(value, "视频状态暂时读取失败")); }
  }
  async function removeTask() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try { await deleteVideoTask(deleteTarget.id); const remaining = tasks.filter((item) => item.id !== deleteTarget.id); setTasks(remaining); setSelectedTaskId(remaining[0]?.id || null); setDeleteTarget(null); setConfirmTarget(null); setNotice("视频任务和参考素材已删除；历史费用账本仍保留"); }
    catch (value) { setError(errorText(value, "视频任务删除失败")); setPhase("error"); } finally { setDeleting(false); }
  }
  function reuse() {
    if (!selectedTask) return;
    const req = record(selectedTask.request);
    if (typeof req.model === "string" && VIDEO_MODELS.some((item) => item.id === req.model)) setModel(req.model);
    if (typeof req.duration === "number") setDuration(req.duration);
    if (typeof req.ratio === "string" && RATIOS.includes(req.ratio)) setRatio(req.ratio);
    if (typeof req.resolution === "string") setResolution(req.resolution);
    if (typeof req.watermark === "boolean") setWatermark(req.watermark);
    if (typeof req.generate_audio === "boolean") setGenerateAudio(req.generate_audio);
    setPrompt(promptOf(selectedTask)); setSkill(skillOf(selectedTask)); setFiles([]); setSelectedTaskId(null); setNotice("已复用参数；参考素材需要重新上传");
  }
  function copyPrompt() { if (selectedTask) void navigator.clipboard?.writeText(promptOf(selectedTask)).then(() => setNotice("提示词已复制")).catch(() => setNotice("浏览器未允许复制")); }

  useEffect(() => { const next = files.map((entry) => ({ file: entry.file, url: URL.createObjectURL(entry.file), kind: entry.kind, role: entry.role })); setPreviews(next); return () => next.forEach((item) => URL.revokeObjectURL(item.url)); }, [files]);
  useEffect(() => { const width = Number(window.localStorage.getItem("fg-creator-video-panel-width")); if (Number.isFinite(width) && width > 0) setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width))); void (async () => { await loadCanvases(); await loadHistory(); })(); }, []);
  useEffect(() => { if (!selectedTask || !["submitting", "queued", "running", "unknown"].includes(selectedTask.status)) return; const timer = window.setInterval(() => void pollTask(), 5000); return () => window.clearInterval(timer); }, [selectedTask?.id, selectedTask?.status]);
  useEffect(() => { if (!previewOpen) return; const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setPreviewOpen(false); }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey); }, [previewOpen]);

  const canvasesView = canvases.map((canvas) => <div className={"video-canvas-row" + (canvas.id === selectedCanvasId ? " active" : "")} key={canvas.id}><button type="button" onClick={() => selectCanvas(canvas)}><Icon d={I.video} size={14} /><span>{canvas.title}</span><small>{dateLabel(canvas.updated_at)}</small></button><button type="button" className="delete-small" onClick={(event) => { event.stopPropagation(); setCanvasDeleteTarget(canvas); }}><Icon d={I.trash} size={13} /></button></div>);
  const historyView = tasks.map((task) => <div className={"video-history-row" + (task.id === selectedTaskId ? " active" : "")} key={task.id}><button type="button" onClick={() => { setSelectedTaskId(task.id); setConfirmTarget(task.status === "draft" && record(task.request).uploads_complete === true ? task : null); }}><span>{promptOf(task) || "未命名生视频任务"}</span><small>{statusLabel(task.status)} · {dateLabel(task.created_at)}</small></button><button type="button" className="delete-small" onClick={() => setDeleteTarget(task)}><Icon d={I.trash} size={14} /></button></div>);

  function center() {
    if (confirmTarget) {
      const req = record(confirmTarget.request);
      return <section className="video-confirm card"><div className="kicker">READY TO COMMIT · ONE CALL</div><h1>确认并生成视频</h1><p>草稿已准备完成。确认后才会调用一次视频服务并写入用量账本。</p><div className="confirm-stats"><div><span>模型</span><b>{getVideoModel(confirmTarget.model)?.label || confirmTarget.model}</b></div><div><span>时长</span><b>{req.duration === -1 ? "自适应" : String(req.duration) + "s"}</b></div><div><span>清晰度</span><b>{String(req.resolution || "")}</b></div><div><span>参考</span><b>{Array.isArray(req.reference_manifest) ? req.reference_manifest.length : 0} 个</b></div></div><div className="confirm-note">FILTER OFF 是模型变体标记，不代表绕过平台安全策略。费用以 Wetoken 实际账单为准，确认后不可撤销。</div><div className="confirm-actions"><button type="button" onClick={() => { setConfirmTarget(null); setPhase("idle"); setNotice("已取消确认，草稿仍保留"); }}>稍后确认</button><button type="button" className="primary" disabled={phase === "confirming"} onClick={() => void confirmTask()}>{phase === "confirming" ? "提交中…" : "确认并生成"}</button></div></section>;
    }
    if (historyLoading || phase === "preparing" || phase === "confirming") return <div className="state card"><div className="spinner" /><h1>{phase === "preparing" ? "准备视频草稿…" : phase === "confirming" ? "确认提交中…" : "加载视频历史…"}</h1><p>只会在明确操作后继续下一步。</p></div>;
    if (phase === "error" && error) return <div className="state card error"><div className="mark">!</div><h1>这次没有生成</h1><p>{error}</p><button type="button" onClick={() => { setPhase("idle"); setError(""); }}>返回编辑</button></div>;
    if (selectedTask && ["submitting", "queued", "running", "unknown"].includes(selectedTask.status)) return <div className="state card"><div className="mark"><Icon d={I.refresh} size={22} /></div><h1>{selectedTask.status === "unknown" ? "任务状态未知" : "视频正在生成"}</h1><p>{notice || "状态会自动刷新，不会重复确认。"}</p><button type="button" onClick={() => void pollTask()}><Icon d={I.refresh} size={14} />刷新状态</button></div>;
    if (selectedTask && (selectedTask.status === "failed" || selectedTask.status === "expired")) return <div className="state card error"><div className="mark">!</div><h1>视频生成未完成</h1><p>{selectedTask.error || "任务失败或已过期；不会自动重试。"}</p><button type="button" onClick={() => { setSelectedTaskId(null); setPhase("idle"); }}>开始新草稿</button></div>;
    if (selectedTask?.status === "succeeded" && selectedTask.videoUrl) return <section className="result card"><div className="result-head"><div><div className="kicker">PRIVATE RESULT</div><h1>视频结果</h1></div><span className="status-chip"><Icon d={I.check} size={13} />已完成</span></div><button type="button" className="result-frame" onClick={() => setPreviewOpen(true)}><video src={selectedTask.videoUrl} controls playsInline /></button><div className="result-meta"><span>{getVideoModel(selectedTask.model)?.label || selectedTask.model}</span><span>{String(record(selectedTask.request).resolution || "")}</span><span>{record(selectedTask.request).duration === -1 ? "自适应" : String(record(selectedTask.request).duration || "") + "s"}</span></div><div className="result-actions"><a href={selectedTask.videoUrl} target="_blank" rel="noreferrer" download><Icon d={I.download} size={15} />打开 / 下载</a><button type="button" onClick={copyPrompt}><Icon d={I.copy} size={15} />复制提示词</button><button type="button" onClick={reuse}><Icon d={I.refresh} size={15} />复用参数</button><button type="button" className="danger" onClick={() => setDeleteTarget(selectedTask)}><Icon d={I.trash} size={15} />删除结果</button></div></section>;
    return <CreatorVideoNodeCanvas key={selectedCanvasId || "video-local"} initialGraph={graph} onGraphChange={onGraphChange} prompt={prompt} previews={previews} onPromptChange={setPrompt} onAddFiles={addFiles} onGenerate={(input) => void prepareDraft(input)} canGenerate={!confirmTarget} generating={false} />;
  }

  const currentModel = activeModel?.label || model;
  const preview = selectedTask?.videoUrl;
  return <div data-theme={theme} className="fg2 video-workspace"><div className="video-backdrop" /><header className="topbar"><div className="logo">FG</div><div><div className="title">AI 创作台</div><div className="subtitle">STANDALONE VIDEO · PRIVATE</div></div><div className="divider" /><span className="context">独立生视频</span><div className="spacer" /><a href="/creator" className="back"><Icon d={I.back} size={15} />返回对话</a><Hov as="button" aria-label="切换主题" onClick={toggle} base={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }} hover={{ background: "var(--panel-2)", color: "var(--text)" }}><span>{theme === "dark" ? "☼" : "☾"}</span></Hov><div className="avatar">{me}</div></header><div className="grid" style={{ "--panel-width": panelWidth + "px" } as CSSProperties}><aside className="sidebar left"><button type="button" className="new-button" onClick={() => void newCanvas()}><Icon d={I.plus} size={16} />新建画布</button><nav className="modes"><a href="/creator"><Icon d={I.chat} size={16} />对话</a><a href="/creator/image"><Icon d={I.image} size={16} />独立生图</a><a href="/creator/video" className="active"><Icon d={I.video} size={16} />视频画布<span /></a></nav><div className="label">视频画布</div><div className="canvas-list">{canvasLoading ? <div className="empty">读取中…</div> : canvasesView}</div><div className="section-head"><div className="label">生成记录</div><button type="button" onClick={clearComposer}><Icon d={I.plus} size={12} />新生成</button></div><div className="history">{historyView.length ? historyView : <div className="empty">确认后的任务会留在这里。</div>}</div><div className="safe"><span>SAFE COMMIT</span><br />先保存草稿，再明确确认。删除不会移除历史费用账本。</div></aside><main className="main"><div className="toolbar"><div><div className="kicker">VIDEO CANVAS / {selectedTask ? statusLabel(selectedTask.status).toUpperCase() : "EMPTY"}</div><h2>视频生成画布</h2></div>{notice && <div className="notice">{notice}</div>}<button type="button" className="mobile-toggle" onClick={() => setMobileControlsOpen((open) => !open)}>{mobileControlsOpen ? "收起参数" : "打开参数"}<Icon d={I.plus} size={14} /></button></div><div className="scroll"><div className="board"><div className="board-head"><div><div className="kicker">VIDEO CANVAS</div><strong>STAGE / {selectedTask ? statusLabel(selectedTask.status).toUpperCase() : "EMPTY"}</strong></div><span>RIGHT CLICK TO ADD NODES</span></div><div className="board-content">{center()}{preview && <button type="button" className="preview-button" onClick={() => setPreviewOpen(true)}><Icon d={I.expand} size={15} />大屏预览</button>}</div></div></div></main><button type="button" className="resizer" role="separator" aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={panelWidth} onPointerDown={(event) => { if (window.innerWidth <= 900) return; resizeRef.current = { x: event.clientX, width: panelWidth }; const move = (item: PointerEvent) => { if (resizeRef.current) { const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, resizeRef.current.width + resizeRef.current.x - item.clientX)); setPanelWidth(next); window.localStorage.setItem("fg-creator-video-panel-width", String(next)); } }; const up = () => { resizeRef.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); }} /><aside className={"sidebar right" + (mobileControlsOpen ? " open" : "")}><button type="button" className="mobile-handle" onClick={() => setMobileControlsOpen((open) => !open)}><span>视频参数</span><span>{mobileControlsOpen ? "收起" : "展开"}</span></button><div className="control-head"><div><div className="kicker">CONTROL SURFACE</div><h2>生成参数</h2></div><small>{currentModel}</small></div><div className="controls"><label>模型<select value={model} onChange={(event) => { setModel(event.target.value); const next = getVideoModel(event.target.value); if (next && !next.resolutions.includes(resolution)) setResolution(next.resolutions[0]); }} disabled={!!confirmTarget}>{VIDEO_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{activeModel?.filterOff && <div className="warning">FILTER OFF 是模型变体标记，不代表绕过平台安全策略。</div>}<div className="field-label"><span>时长</span><strong>{duration === -1 ? "自适应" : `${duration}s`}</strong></div><div className="duration-control"><input type="range" min={DURATION_MIN} max={DURATION_MAX} step={1} value={duration === -1 ? DEFAULT_DURATION : duration} onChange={(event) => setDuration(Number(event.target.value))} disabled={!!confirmTarget} aria-label="视频时长" aria-valuetext={duration === -1 ? "自适应" : `${duration}秒`} /><div className="duration-scale"><span>{DURATION_MIN}s</span><span>{DURATION_MAX}s</span></div><button type="button" className={"adaptive-choice" + (duration === -1 ? " active" : "")} onClick={() => setDuration(duration === -1 ? DEFAULT_DURATION : -1)} disabled={!!confirmTarget}>自适应</button></div><div className="field-label">画幅</div><div className="choice-grid">{RATIOS.map((value) => <button type="button" key={value} className={ratio === value ? "active" : ""} onClick={() => setRatio(value)} disabled={!!confirmTarget}>{value}</button>)}</div><label>清晰度<select value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={!!confirmTarget}>{(activeModel?.resolutions || ["480p"]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><div className="toggles"><label><input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} disabled={!!confirmTarget} />生成音频</label><label><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} disabled={!!confirmTarget} />保留水印</label></div><div className="field-label"><span>参考素材</span><span>{files.length}/15</span></div><label className="dropzone"><Icon d={I.upload} size={20} /><b>拖放或选择图片 / 视频 / 音频</b><small>图片 ≤ 7MB · 视频 ≤ 120MB · 音频 ≤ 24MB · 总计 ≤ 180MB</small><input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm" onChange={changeFile} disabled={!!confirmTarget} /></label>{files.length > 0 && <div className="file-list">{files.map((entry, index) => <div className="file-row" key={keyFor(entry.file)}><span className={"kind " + entry.kind}>{entry.kind.toUpperCase()}</span><span className="file-name" title={entry.file.name}>{entry.file.name}</span><select value={entry.role} onChange={(event) => updateRole(index, event.target.value as VideoReferenceRole)} disabled={!!confirmTarget}>{roleOptions(entry.kind).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><button type="button" onClick={() => removeFile(index)} disabled={!!confirmTarget}><Icon d={I.close} size={12} /></button></div>)}</div>}<div className="pickers"><SkillPicker active={skill?.name || null} onApply={(name, content) => setSkill({ name, content })} onClear={() => setSkill(null)} /><PromptPicker onInsert={(text) => setPrompt((current) => current.trim() ? current.trimEnd() + "\n" + text : text)} /></div><label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="写下镜头动作、摄影机、主体、环境、光线与节奏…" disabled={!!confirmTarget} /></label><div className="prompt-meta"><span>{skill ? "Skill · " + skill.name : "未启用 Skill"}</span><span>{prompt.length}/30k</span></div></div><div className="footer"><button type="button" disabled={!!confirmTarget || phase === "preparing" || (!prompt.trim() && files.length === 0)} onClick={() => void prepareDraft()}><Icon d={I.spark} size={16} />{phase === "preparing" ? "准备中…" : "准备视频草稿"}</button><small>先建草稿；确认后才会调用。</small></div></aside></div>{previewOpen && preview && <div className="modal-backdrop" onMouseDown={() => setPreviewOpen(false)}><div className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><h2>大屏预览</h2><button type="button" onClick={() => setPreviewOpen(false)}><Icon d={I.close} size={15} />关闭</button></div><div className="preview-stage"><video src={preview} controls autoPlay playsInline /></div><div className="modal-foot"><span>{currentModel}</span><a href={preview} target="_blank" rel="noreferrer" download><Icon d={I.download} size={14} />打开 / 下载</a></div></div></div>}{canvasDeleteTarget && <div className="modal-backdrop" onMouseDown={() => !canvasDeleting && setCanvasDeleteTarget(null)}><div className="delete-modal" onMouseDown={(event) => event.stopPropagation()}><Icon d={I.trash} size={18} /><h2>删除这个视频画布？</h2><p>只删除画布布局，不删除视频任务或费用账本。</p><div className="modal-actions"><button type="button" onClick={() => setCanvasDeleteTarget(null)}>取消</button><button type="button" className="danger" disabled={canvasDeleting} onClick={() => void removeCanvas()}>{canvasDeleting ? "删除中…" : "删除画布"}</button></div></div></div>}{deleteTarget && <div className="modal-backdrop" onMouseDown={() => !deleting && setDeleteTarget(null)}><div className="delete-modal" onMouseDown={(event) => event.stopPropagation()}><Icon d={I.trash} size={18} /><h2>永久删除视频任务？</h2><p>任务和参考素材会被删除，历史费用账本会保留。</p><div className="modal-actions"><button type="button" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="danger" disabled={deleting} onClick={() => void removeTask()}>{deleting ? "删除中…" : "永久删除"}</button></div></div></div>}<style jsx>{`
.video-workspace{position:relative;isolation:isolate;min-height:100vh;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);color:var(--text)}.video-backdrop{position:fixed;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(720px 520px at 100% 0%,var(--glow-coral),transparent 62%),radial-gradient(800px 600px at -10% 110%,var(--glow-b),transparent 60%)}.topbar{height:60px;flex:none;display:flex;align-items:center;gap:13px;padding:0 18px;border-bottom:1px solid var(--stroke);background:var(--panel);backdrop-filter:blur(24px)}.logo,.avatar{display:grid;place-items:center;background:linear-gradient(150deg,var(--accent),var(--accent-2));color:var(--accent-ink);font-weight:700}.logo{width:34px;height:34px;border-radius:10px}.avatar{width:34px;height:34px;border-radius:50%;font-size:11px}.title{font-size:14px;font-weight:650}.subtitle,.kicker{color:var(--text-3);font-size:9px;letter-spacing:1.1px}.divider{width:1px;height:24px;background:var(--stroke)}.context{color:var(--text-2);font-size:12px}.spacer{flex:1}.back{height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;border:1px solid var(--stroke);border-radius:10px;color:var(--text-2);text-decoration:none;font-size:12px}.grid{display:grid;grid-template-columns:248px minmax(360px,1fr) 12px var(--panel-width);flex:1;min-height:0}.sidebar{min-height:0;display:flex;flex-direction:column;padding:12px;background:color-mix(in srgb,var(--panel) 86%,transparent)}.left{border-right:1px solid var(--stroke)}.right{border-left:1px solid var(--stroke);background:color-mix(in srgb,var(--panel-solid) 82%,transparent)}.new-button{height:42px;border:1px solid var(--user-stroke);border-radius:12px;background:var(--user-bubble);color:var(--text);font-size:13px;cursor:pointer}.modes{display:grid;gap:5px;margin-top:10px}.modes a{min-height:42px;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid transparent;border-radius:11px;color:var(--text-2);text-decoration:none;font-size:12px}.modes a.active{border-color:var(--stroke-2);background:var(--panel-2);color:var(--accent)}.modes a span{width:5px;height:5px;margin-left:auto;border-radius:50%;background:var(--accent)}.label{padding:18px 9px 7px;color:var(--text-3);font:9.5px "JetBrains Mono",monospace;letter-spacing:1.2px}.canvas-list{max-height:190px;overflow:auto}.video-canvas-row,.video-history-row{display:flex;align-items:center;gap:4px;margin-bottom:3px;border:1px solid transparent;border-radius:10px}.video-canvas-row.active,.video-history-row.active{border-color:var(--stroke-2);background:var(--panel-2)}.video-canvas-row button:first-child,.video-history-row button:first-child{min-width:0;flex:1;display:flex;align-items:center;gap:8px;padding:8px 5px 8px 10px;border:0;background:transparent;color:var(--text-2);cursor:pointer;text-align:left}.video-canvas-row span,.video-history-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}.video-canvas-row small,.video-history-row small{display:block;color:var(--text-3);font-size:8.5px}.delete-small{width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent;color:var(--text-3);cursor:pointer}.history{flex:1;min-height:0;overflow:auto}.video-history-row button:first-child{display:block;padding:9px 5px 9px 10px}.video-history-row small{margin-top:4px}.safe{margin-top:12px;padding:10px;border:1px solid var(--stroke);border-radius:11px;color:var(--text-3);font-size:10.5px;line-height:1.6}.safe span{color:var(--accent);font:9px "JetBrains Mono",monospace}.section-head{display:flex;align-items:center;justify-content:space-between}.section-head .label{flex:1}.section-head button{margin-top:14px;padding:4px 6px;border:0;background:transparent;color:var(--text-3);font-size:10px;cursor:pointer}.main{min-width:0;min-height:0;display:flex;flex-direction:column}.toolbar,.control-head{min-height:70px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 22px;border-bottom:1px solid var(--stroke)}.toolbar h2,.control-head h2{margin:4px 0 0;font-size:14px}.notice{max-width:52%;color:var(--text-2);font-size:11px;text-align:right}.scroll{flex:1;min-height:0;display:flex;overflow:auto;padding:24px;background:linear-gradient(rgba(116,240,142,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(116,240,142,.035) 1px,transparent 1px),var(--bg);background-size:32px 32px}.board{width:min(1220px,100%);min-height:min(720px,calc(100vh - 160px));display:flex;flex-direction:column;margin:auto;overflow:hidden;border:1px solid var(--stroke-2);border-radius:24px;background:color-mix(in srgb,var(--panel) 88%,transparent);box-shadow:var(--shadow)}.board-head{min-height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 17px;border-bottom:1px solid var(--stroke)}.board-head strong{display:block;margin-top:4px;color:var(--text-2);font:10px "JetBrains Mono",monospace}.board-head span{color:var(--text-3);font:9px "JetBrains Mono",monospace}.board-content{position:relative;flex:1;min-height:0;display:flex;overflow:auto;padding:28px}.board-content>*{margin:auto}.resizer{width:12px;border:0;border-right:1px solid var(--stroke);border-left:1px solid var(--stroke);background:color-mix(in srgb,var(--panel) 72%,transparent);cursor:col-resize}.control-head{padding:0 16px}.control-head small{max-width:170px;color:var(--text-3);font:9px "JetBrains Mono",monospace;text-align:right}.controls{flex:1;min-height:0;overflow:auto;padding:17px 16px}.controls>label{display:block;margin-bottom:15px;color:var(--text-3);font:10px "JetBrains Mono",monospace;text-transform:uppercase}.controls select,.controls textarea{width:100%;margin-top:7px;border:1px solid var(--stroke);border-radius:10px;background:var(--panel);color:var(--text);font:inherit}.controls select{height:40px;padding:0 9px}.controls textarea{min-height:145px;resize:vertical;padding:10px;line-height:1.65}.warning{margin:-5px 0 15px;padding:9px;border:1px solid rgba(255,170,115,.35);border-radius:9px;color:#ffc18e;font-size:10px;line-height:1.5}.field-label{display:flex;justify-content:space-between;margin:0 0 7px;color:var(--text-3);font:10px "JetBrains Mono",monospace}.choice-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:16px}.choice-grid button{min-height:35px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel);color:var(--text-2);font:10px "JetBrains Mono",monospace;cursor:pointer}.choice-grid button.active{border-color:var(--user-stroke);background:var(--user-bubble);color:var(--accent)}.toggles{display:flex;gap:12px;margin:2px 0 17px;color:var(--text-2);font-size:11px}.toggles label{display:flex;align-items:center;gap:5px}.toggles input{accent-color:var(--accent)}.dropzone{display:flex!important;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:14px;border:1px dashed var(--stroke-2);border-radius:12px;cursor:pointer}.dropzone svg{color:var(--accent)}.dropzone small{color:var(--text-3);font:9px inherit}.dropzone input{display:none}.file-list{display:grid;gap:5px;margin:9px 0 16px}.file-row{display:grid;grid-template-columns:35px minmax(0,1fr) 86px 24px;align-items:center;gap:5px;padding:5px;border:1px solid var(--stroke);border-radius:8px}.kind{font:8px "JetBrains Mono",monospace;color:var(--accent)}.kind.video{color:var(--accent-2)}.kind.audio{color:#ffc06a}.file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2);font-size:10px}.file-row select{width:86px;height:25px;border:1px solid var(--stroke);border-radius:6px;background:var(--panel);color:var(--text-2);font-size:9px}.file-row button{width:24px;height:24px;border:0;background:transparent;color:var(--text-3);cursor:pointer}.pickers{display:flex;gap:6px;margin-bottom:13px}.pickers :global(button){min-height:28px}.prompt-meta{display:flex;justify-content:space-between;margin-top:5px;color:var(--text-3);font-size:9px}.footer{flex:none;padding:12px 16px 15px;border-top:1px solid var(--stroke);text-align:center}.footer button{width:100%;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:700;cursor:pointer}.footer button:disabled{opacity:.4;cursor:not-allowed}.footer small{display:block;margin-top:7px;color:var(--text-3);font-size:9px}.card{width:min(850px,100%);margin:auto;padding:27px;border:1px solid var(--stroke);border-radius:20px;background:var(--panel);box-shadow:var(--shadow)}.confirm{border-color:var(--user-stroke);background:linear-gradient(145deg,var(--panel-2),var(--user-bubble))}.card h1{margin:10px 0 8px;font-size:23px}.card p{margin:0;color:var(--text-2);font-size:13px;line-height:1.7}.confirm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:20px}.confirm-stats div{padding:10px;border:1px solid var(--stroke);border-radius:9px}.confirm-stats span{display:block;color:var(--text-3);font-size:9px}.confirm-stats b{display:block;margin-top:5px;font-size:10px}.confirm-note{margin-top:14px;padding:11px;border:1px solid var(--stroke);border-radius:10px;color:var(--text-2);font-size:11px;line-height:1.6}.confirm-actions,.result-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.confirm-actions button,.state button{height:37px;padding:0 14px;border:1px solid var(--stroke-2);border-radius:9px;background:var(--panel);color:var(--text-2);cursor:pointer}.confirm-actions .primary{border:0;background:var(--accent);color:var(--accent-ink);font-weight:700}.state{text-align:center;max-width:470px}.state .mark{width:43px;height:43px;display:grid;place-items:center;margin:auto;border-radius:13px;background:var(--user-bubble);color:var(--accent);font-weight:700}.state.error .mark{background:rgba(255,119,89,.12);color:#ff9b85}.state.error h1{color:#ffb0a0}.state button{display:inline-flex;align-items:center;gap:7px;margin-top:17px}.spinner{width:28px;height:28px;margin:auto;border:2px solid var(--stroke-2);border-top-color:var(--accent);border-radius:50%;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.result-head{display:flex;justify-content:space-between}.result-frame{display:block;width:100%;padding:0;overflow:hidden;border:1px solid var(--stroke-2);border-radius:16px;background:var(--panel);cursor:zoom-in}.result-frame video{display:block;width:100%;max-height:65vh;object-fit:contain}.status-chip{display:inline-flex;align-items:center;gap:5px;color:var(--accent);font-size:11px}.result-meta{display:flex;gap:16px;padding:10px 0;color:var(--text-3);font:10px "JetBrains Mono",monospace}.result-actions{justify-content:flex-start;flex-wrap:wrap;margin-top:0}.result-actions a,.result-actions button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel);color:var(--text-2);font-size:11px;text-decoration:none;cursor:pointer}.result-actions .danger,.modal-actions .danger{color:#ff9b85}.preview-button{position:absolute;right:25px;bottom:25px;z-index:4;height:37px;padding:0 12px;border:1px solid var(--user-stroke);border-radius:10px;background:var(--panel-solid);color:var(--accent);cursor:pointer}.modal-backdrop{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:18px;background:rgba(4,8,18,.75);backdrop-filter:blur(10px)}.preview-modal{width:min(1480px,100%);height:min(900px,100%);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--stroke-2);border-radius:20px;background:var(--panel-solid)}.modal-head,.modal-foot{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--stroke)}.modal-head h2{margin:0;font-size:16px}.modal-head button{height:32px;padding:0 10px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel);color:var(--text-2);cursor:pointer}.preview-stage{flex:1;min-height:0;display:grid;place-items:center;overflow:auto;padding:30px;background:#050812}.preview-stage video{max-width:100%;max-height:100%}.modal-foot{border-top:1px solid var(--stroke);border-bottom:0;color:var(--text-3);font-size:10px}.modal-foot a{display:flex;align-items:center;gap:5px;color:var(--accent);text-decoration:none}.delete-modal{width:min(420px,100%);padding:22px;border:1px solid var(--stroke-2);border-radius:17px;background:var(--panel-solid);color:var(--text)}.delete-modal h2{margin:15px 0 7px;font-size:17px}.delete-modal p{color:var(--text-2);font-size:12px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.modal-actions button{height:36px;padding:0 14px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel);color:var(--text-2);cursor:pointer}.modal-actions .danger{border:0;background:#e65f4c;color:#fff}.video-workspace[data-theme="dark"]{--text-2:rgba(234,240,250,.78);--text-3:rgba(234,240,250,.62);color-scheme:dark}.video-workspace[data-theme="light"]{--text-2:rgba(11,16,27,.78);--text-3:rgba(11,16,27,.64);color-scheme:light}.video-workspace .kicker,.video-workspace .subtitle{color:var(--text-2);font-size:10px}.video-workspace .label,.video-workspace .safe,.video-workspace .board-head span,.video-workspace .control-head small,.video-workspace .prompt-meta,.video-workspace .footer small{color:var(--text-2)}.video-workspace .video-canvas-row small,.video-workspace .video-history-row small,.video-workspace .delete-small,.video-workspace .section-head button{color:var(--text-2)}.video-workspace .controls>label{color:var(--text-2);font-size:11px;line-height:1.35}.video-workspace .controls select,.video-workspace .controls textarea{font-size:12px}.video-workspace .controls select option,.video-workspace .file-row select option{background:var(--panel-solid);color:var(--text)}.video-workspace .field-label{color:var(--text-2);font-size:11px;line-height:1.35}.video-workspace .field-label strong{color:var(--text);font-size:12px}.video-workspace .choice-grid button{color:var(--text);font-size:11px}.video-workspace .dropzone b{color:var(--text);font-size:11px}.video-workspace .dropzone small{color:var(--text-2);font-size:10px}.video-workspace .controls textarea::placeholder{color:var(--text-3);opacity:1}.duration-control{margin-bottom:16px;padding:10px 11px 9px;border:1px solid var(--stroke);border-radius:12px;background:var(--panel)}.duration-control>input[type="range"]{width:100%;height:20px;margin:1px 0 0;accent-color:var(--accent);cursor:pointer}.duration-control>input[type="range"]:disabled{opacity:.45;cursor:not-allowed}.duration-scale{display:flex;justify-content:space-between;margin-top:1px;color:var(--text-2);font:10px "JetBrains Mono",monospace}.adaptive-choice{height:30px;margin-top:8px;padding:0 10px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel-solid);color:var(--text-2);font-size:11px;cursor:pointer}.adaptive-choice.active{border-color:var(--user-stroke);background:var(--user-bubble);color:var(--accent)}.adaptive-choice:disabled{opacity:.45;cursor:not-allowed}.mobile-toggle,.mobile-handle{display:none}@media(max-width:1200px){.grid{grid-template-columns:220px minmax(0,1fr) 12px min(40vw,var(--panel-width))}}@media(max-width:900px){.video-workspace{height:100vh}.grid{grid-template-columns:1fr}.resizer{display:none}.main{order:2}.right{position:fixed;z-index:20;left:10px;right:10px;bottom:0;max-height:78vh;border:1px solid var(--stroke-2);border-bottom:0;border-radius:17px 17px 0 0;transform:translateY(calc(100% - 55px));transition:transform .24s}.right.open{transform:translateY(0)}.mobile-toggle,.mobile-handle{display:inline-flex}.mobile-handle{width:100%;justify-content:space-between;min-height:55px;padding:0 15px;border:0;border-bottom:1px solid var(--stroke);background:var(--panel);color:var(--text);font-size:12px}.controls{max-height:calc(78vh - 130px)}.left{border:0;min-height:auto}.history{max-height:180px}.scroll{padding-bottom:80px}}@media(max-width:560px){.context,.divider{display:none}.topbar{padding:0 12px;gap:9px}.toolbar{padding:0 15px}.scroll{padding:15px}.confirm-stats{grid-template-columns:repeat(2,1fr)}.result-actions a,.result-actions button{flex:1 1 calc(50% - 8px);justify-content:center}}
`}</style></div>;
}
