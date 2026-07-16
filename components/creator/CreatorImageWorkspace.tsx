"use client";

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { Icon, Hov, useFgTheme } from "@/components/studio/ui";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_CREATOR_IMAGE_FILE_BYTES,
  MAX_CREATOR_IMAGE_REFERENCES,
  MAX_CREATOR_IMAGE_TOTAL_BYTES,
  validateImageDraftInput,
  type CreatorImageSkill,
  type ImageReferenceManifest,
} from "@/lib/creator/image";
import type { CreatorImageTask, CreatorImageTaskView } from "@/lib/creator/types";
import {
  confirmImageTask,
  createImageDraft,
  CreatorImageClientError,
  deleteImageTask,
  finalizeImageUploads,
  listImageTasks,
} from "@/lib/creator/image-client";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";

type Props = { userEmail: string };
type Phase = "idle" | "preparing" | "confirming" | "error" | "unknown" | "submitting";

const TASK_QUERY_MAX_LENGTH = 128;
const IMAGE_PANEL_MIN_WIDTH = 320;
const IMAGE_PANEL_MAX_WIDTH = 560;
const IMAGE_PANEL_DEFAULT_WIDTH = 408;

function clampImagePanelWidth(value: number) {
  return Math.min(IMAGE_PANEL_MAX_WIDTH, Math.max(IMAGE_PANEL_MIN_WIDTH, Math.round(value)));
}

function taskIdFromLocation() {
  if (typeof window === "undefined") return null;
  const candidate = new URLSearchParams(window.location.search).get("task")?.trim() || "";
  if (!candidate || candidate.length > TASK_QUERY_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(candidate)) return null;
  return candidate;
}

function replaceTaskQuery(taskId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (taskId) url.searchParams.set("task", taskId);
  else url.searchParams.delete("task");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

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

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function taskPrompt(task: CreatorImageTaskView | CreatorImageTask) {
  const prompt = asRecord(task.request).prompt;
  return typeof prompt === "string" ? prompt : "";
}

function taskSkill(task: CreatorImageTaskView | CreatorImageTask): CreatorImageSkill | null {
  const skill = asRecord(asRecord(task.request).skill);
  return typeof skill.name === "string" && typeof skill.content === "string"
    ? { name: skill.name, content: skill.content }
    : null;
}

function taskSize(task: CreatorImageTaskView | CreatorImageTask) {
  const value = asRecord(task.request).size;
  return typeof value === "string" ? value : sizeFor(task.model, String(asRecord(task.request).ratio || "1:1"));
}

function taskReferenceCount(task: CreatorImageTaskView | CreatorImageTask) {
  const request = asRecord(task.request);
  return Array.isArray(request.reference_manifest) ? request.reference_manifest.length : 0;
}

function taskDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function statusLabel(status: CreatorImageTask["status"]) {
  const labels: Record<CreatorImageTask["status"], string> = {
    draft: "草稿",
    submitting: "提交中",
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    expired: "已过期",
    unknown: "状态未知",
  };
  return labels[status] || status;
}

function publicError(error: unknown, fallback: string) {
  return error instanceof CreatorImageClientError ? error.message : fallback;
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `creator-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isConfirmableDraft(task: CreatorImageTask | CreatorImageTaskView) {
  return task.status === "draft" && asRecord(task.request).uploads_complete === true;
}

function imageModelLabel(model: string) {
  return IMG_MODELS.find((item) => item.id === model)?.label || model;
}

function resultFileExtension(task: CreatorImageTaskView) {
  const mime = task.asset?.mime_type?.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  const path = (task.resultUrl || "").split("?")[0];
  const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === "jpeg" || ext === "jpg") return "jpg";
  if (ext === "webp") return "webp";
  return "png";
}

export default function CreatorImageWorkspace({ userEmail }: Props) {
  const { theme, toggle } = useFgTheme();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  const [model, setModel] = useState(IMG_MODELS[0].id);
  const [ratio, setRatio] = useState(RATIOS[1].key);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [activeSkill, setActiveSkill] = useState<CreatorImageSkill | null>(null);
  const [tasks, setTasks] = useState<CreatorImageTaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CreatorImageTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CreatorImageTaskView | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [idempotencySignature, setIdempotencySignature] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [controlPanelWidth, setControlPanelWidth] = useState(IMAGE_PANEL_DEFAULT_WIDTH);
  const [previewOpen, setPreviewOpen] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTask = tasks.find((item) => item.id === selectedTaskId) || null;
  const me = userEmail.replace(/@.*/, "").slice(0, 2).toUpperCase();

  function localFileError(nextFiles: File[]) {
    if (nextFiles.length > MAX_CREATOR_IMAGE_REFERENCES) return "最多 8 张参考图";
    let total = 0;
    for (const file of nextFiles) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "参考图仅支持 JPEG、PNG 或 WebP";
      if (file.size <= 0 || file.size > MAX_CREATOR_IMAGE_FILE_BYTES) return "单张参考图不能超过 7MB";
      total += file.size;
    }
    if (total > MAX_CREATOR_IMAGE_TOTAL_BYTES) return "参考图总大小不能超过 28MB";
    return null;
  }

  function addFiles(incoming: File[]) {
    const merged = [...files];
    for (const file of incoming) {
      const duplicate = merged.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!duplicate) merged.push(file);
    }
    const validationError = localFileError(merged);
    if (validationError) {
      setError(validationError);
      setPhase("error");
      return;
    }
    setError("");
    setNotice("");
    setFiles(merged);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (confirmTarget) return;
    addFiles(Array.from(event.dataTransfer.files || []));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onDropzoneKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setError("");
  }

  function updateControlPanelWidth(value: number) {
    const next = clampImagePanelWidth(value);
    setControlPanelWidth(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fg-creator-image-panel-width", String(next));
    }
  }

  function beginControlPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth <= 900) return;
    event.preventDefault();
    resizeStartRef.current = { startX: event.clientX, startWidth: controlPanelWidth };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      updateControlPanelWidth(start.startWidth + start.startX - moveEvent.clientX);
    };
    const onUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onControlPanelResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateControlPanelWidth(controlPanelWidth + 24);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateControlPanelWidth(controlPanelWidth - 24);
    } else if (event.key === "Home") {
      event.preventDefault();
      updateControlPanelWidth(IMAGE_PANEL_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      updateControlPanelWidth(IMAGE_PANEL_MAX_WIDTH);
    }
  }

  function onReferenceDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    if (confirmTarget) return;
    setDragIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function onReferenceDragEnd() {
    setDragIndex(null);
  }

  function onReferenceDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault();
    if (confirmTarget) return;
    const fromTransfer = Number(event.dataTransfer.getData("text/plain"));
    const sourceIndex = dragIndex ?? fromTransfer;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= files.length || sourceIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    setFiles((current) => {
      const reordered = [...current];
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      return reordered;
    });
    setDragIndex(null);
  }

  function draftInputSignature() {
    return JSON.stringify({
      prompt,
      model,
      ratio,
      skill: activeSkill,
      files: files.map((file) => ({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified })),
    });
  }

  function clearComposer() {
    setPrompt("");
    setFiles([]);
    setActiveSkill(null);
    setConfirmTarget(null);
    setIdempotencyKey(null);
    setIdempotencySignature(null);
    setDragIndex(null);
    setSelectedTaskId(null);
    replaceTaskQuery(null);
    setError("");
    setNotice("");
    setPhase("idle");
  }

  function openDeleteModal(task: CreatorImageTaskView, trigger?: HTMLButtonElement) {
    deleteReturnFocusRef.current = trigger || null;
    setDeleteTarget(task);
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteTarget(null);
    window.setTimeout(() => deleteReturnFocusRef.current?.focus(), 0);
  }

  function selectTask(task: CreatorImageTaskView) {
    setSelectedTaskId(task.id);
    replaceTaskQuery(task.id);
    setConfirmTarget(isConfirmableDraft(task) ? task : null);
    setError("");
    setNotice("");
    setPhase(task.status === "unknown" ? "unknown" : task.status === "submitting" || task.status === "queued" || task.status === "running" ? "submitting" : "idle");
  }

  async function refreshHistory(preferId?: string) {
    setLoadingHistory(true);
    try {
      const response = await listImageTasks();
      const nextTasks = response.tasks || [];
      const nextId = preferId && nextTasks.some((task) => task.id === preferId)
        ? preferId
        : selectedTaskId && nextTasks.some((task) => task.id === selectedTaskId)
          ? selectedTaskId
          : nextTasks[0]?.id || null;
      const nextTask = nextTasks.find((task) => task.id === nextId) || null;
      setTasks(nextTasks);
      setSelectedTaskId(nextId);
      setConfirmTarget(nextTask && isConfirmableDraft(nextTask) ? nextTask : null);
      replaceTaskQuery(nextId);
    } catch (loadError) {
      setError(publicError(loadError, "历史加载失败，请稍后重试"));
      setPhase("error");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function prepareDraft() {
    if (phase === "preparing" || phase === "confirming" || confirmTarget) return;
    setError("");
    setNotice("");
    const references: ImageReferenceManifest[] = files.map((file) => ({ name: file.name, mimeType: file.type, size: file.size }));
    const fileError = localFileError(files);
    if (fileError) {
      setError(fileError);
      setPhase("error");
      return;
    }
    try {
      validateImageDraftInput({ prompt, model, ratio, references, skill: activeSkill });
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "请输入有效的提示词");
      setPhase("error");
      return;
    }

    setPhase("preparing");
    const inputSignature = draftInputSignature();
    const attemptKey = idempotencyKey && idempotencySignature === inputSignature
      ? idempotencyKey
      : createIdempotencyKey();
    setIdempotencyKey(attemptKey);
    setIdempotencySignature(inputSignature);
    try {
      const draft = await createImageDraft({
        prompt,
        model,
        ratio,
        references,
        skill: activeSkill,
        idempotencyKey: attemptKey,
      });
      if (draft.uploadPaths.length !== files.length) throw new Error("upload plan mismatch");
      for (let index = 0; index < files.length; index += 1) {
        const upload = await supabase.storage.from("creator-assets").upload(draft.uploadPaths[index], files[index], {
          upsert: false,
          contentType: files[index].type,
        });
        if (upload.error) throw upload.error;
      }
      const ready = await finalizeImageUploads(draft.task.id, draft.uploadPaths);
      setTasks((current) => {
        const view: CreatorImageTaskView = { ...ready.task, asset: null, resultUrl: null, referenceUrls: [] };
        return [view, ...current.filter((item) => item.id !== view.id)];
      });
      setSelectedTaskId(ready.task.id);
      setConfirmTarget(ready.task);
      setIdempotencyKey(null);
      setIdempotencySignature(null);
      setPhase("idle");
    } catch (draftError) {
      setError(publicError(draftError, "草稿准备失败，参考图未完成上传"));
      setPhase("error");
    }
  }

  async function confirmTargetTask() {
    if (!confirmTarget || phase === "confirming") return;
    const target = confirmTarget;
    setError("");
    setNotice("");
    setPhase("confirming");
    try {
      const response = await confirmImageTask(target.id);
      setConfirmTarget(null);
      if (response.requiresReconciliation || response.ledgerStatus === "unknown") {
        setPhase("unknown");
        setNotice("任务已提交，但账本状态需要对账；刷新只读取任务列表，不会自动确认。请稍后查看状态。");
        await refreshHistory(target.id);
        return;
      }
      const nextStatus = response.task?.status;
      if (nextStatus === "unknown") {
        setPhase("unknown");
        setNotice("任务状态未知；刷新只读取任务列表，不会自动确认。");
      } else if (nextStatus === "submitting" || nextStatus === "queued" || nextStatus === "running") {
        setPhase("submitting");
        setNotice("任务已提交，正在生成；刷新只读取任务列表，不会自动确认。");
      } else {
        setPhase("idle");
      }
      await refreshHistory(target.id);
    } catch (confirmError) {
      setConfirmTarget(null);
      if (confirmError instanceof CreatorImageClientError && confirmError.status === 503) {
        setPhase("unknown");
        setNotice("服务返回对账或状态未知（503）；这次不会重试确认。刷新只读取任务列表。");
        await refreshHistory(target.id);
      } else if (confirmError instanceof CreatorImageClientError && confirmError.code === "IDEMPOTENCY_CONFLICT") {
        setPhase("submitting");
        setNotice("任务已被其他请求提交；刷新只读取任务列表，不会重复确认。");
        await refreshHistory(target.id);
      } else if (confirmError instanceof CreatorImageClientError && confirmError.status === 0) {
        setPhase("unknown");
        setNotice("确认请求可能未返回；这次不会自动重试，请刷新任务历史后再决定。");
        await refreshHistory(target.id);
      } else {
        setPhase("error");
        setError(publicError(confirmError, "图片确认失败，请稍后重试"));
      }
    }
  }

  async function copyPrompt() {
    if (!selectedTask) return;
    try {
      await navigator.clipboard.writeText(taskPrompt(selectedTask));
      setNotice("提示词已复制");
    } catch {
      setNotice("浏览器未允许复制，请手动选择提示词");
    }
  }

  function reuseParameters() {
    if (!selectedTask) return;
    const request = asRecord(selectedTask.request);
    if (typeof request.model === "string" && IMG_MODELS.some((item) => item.id === request.model)) setModel(request.model);
    if (typeof request.ratio === "string" && RATIOS.some((item) => item.key === request.ratio)) setRatio(request.ratio);
    setPrompt(taskPrompt(selectedTask));
    setActiveSkill(taskSkill(selectedTask));
    setFiles([]);
    setIdempotencyKey(null);
    setIdempotencySignature(null);
    setSelectedTaskId(null);
    replaceTaskQuery(null);
    setNotice("已复用模型、比例和提示词；参考图需要重新上传。");
    setPhase("idle");
  }

  async function removeTask() {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      await deleteImageTask(target.id);
      const nextTasks = tasks.filter((task) => task.id !== target.id);
      const nextId = selectedTaskId === target.id
        ? nextTasks[0]?.id || null
        : selectedTaskId;
      const nextTask = nextTasks.find((task) => task.id === nextId) || null;
      setTasks(nextTasks);
      setSelectedTaskId(nextId);
      replaceTaskQuery(nextId);
      setConfirmTarget(nextTask && isConfirmableDraft(nextTask) ? nextTask : null);
      if (!nextTask) {
        setPhase("idle");
      } else if (nextTask.status === "unknown") {
        setPhase("unknown");
      } else if (nextTask.status === "submitting" || nextTask.status === "queued" || nextTask.status === "running") {
        setPhase("submitting");
      } else {
        setPhase("idle");
      }
      setDeleteTarget(null);
      setNotice("任务、结果和参考图已删除；历史费用账本仍保留。");
    } catch (deleteError) {
      setError(publicError(deleteError, "删除任务失败，请稍后重试"));
      setPhase("error");
    } finally {
      setDeleting(false);
    }
  }

  // Keep browser effects below the action handlers so refresh can never call confirmation.
  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);

  useEffect(() => {
    if (!deleteTarget) return;
    deleteCancelRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDeleteModal();
        return;
      }
      if (event.key !== "Tab") return;
      const first = deleteCancelRef.current;
      const last = deleteConfirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteTarget, deleting]);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem("fg-creator-image-panel-width"));
    if (Number.isFinite(stored) && stored > 0) setControlPanelWidth(clampImagePanelWidth(stored));
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!selectedTask?.resultUrl) setPreviewOpen(false);
  }, [selectedTask?.resultUrl]);

  useEffect(() => {
    const taskId = taskIdFromLocation();
    void refreshHistory(taskId || undefined);
  }, []);

  const historyRows = tasks.map((task) => (
    <div key={task.id} className="image-history-row" style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 10, border: `1px solid ${selectedTaskId === task.id ? "var(--stroke-2)" : "transparent"}`, background: selectedTaskId === task.id ? "var(--panel-2)" : "transparent" }}>
      <button type="button" onClick={() => selectTask(task)} title={taskPrompt(task) || "独立生图任务"} style={{ flex: 1, minWidth: 0, padding: "10px 5px 10px 11px", textAlign: "left", border: 0, background: "transparent", color: selectedTaskId === task.id ? "var(--text)" : "var(--text-2)", cursor: "pointer" }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{taskPrompt(task) || "未命名生图任务"}</span>
        <span className="fg-mono" style={{ display: "block", marginTop: 4, fontSize: 9.5, color: task.status === "failed" ? "#ff9b85" : "var(--text-3)" }}>{statusLabel(task.status)} · {taskDate(task.created_at)}</span>
      </button>
      <button type="button" aria-label={`删除任务 ${task.id}`} title="删除任务" onClick={(event) => openDeleteModal(task, event.currentTarget)} style={{ width: 30, height: 30, flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: 8, background: "transparent", color: "var(--text-3)", cursor: "pointer" }}><Icon d={I.trash} size={14} /></button>
    </div>
  ));

  const renderCenter = () => {
    if (confirmTarget) {
      const size = taskSize(confirmTarget);
      return (
        <section className="image-confirm-card" aria-labelledby="image-confirm-title" style={{ width: "min(620px,100%)", margin: "auto", padding: 26, borderRadius: 22, border: "1px solid var(--user-stroke)", background: "linear-gradient(145deg,var(--panel-2),var(--user-bubble))", boxShadow: "var(--shadow)" }}>
          <div className="fg-mono" style={{ color: "var(--accent)", fontSize: 10, letterSpacing: 1.5 }}>READY TO COMMIT · ONE CALL</div>
          <h1 id="image-confirm-title" style={{ margin: "12px 0 8px", fontSize: 24, letterSpacing: "-.5px" }}>确认并生成</h1>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13, lineHeight: 1.75 }}>草稿已准备完成。确认后将只调用 1 次图片生成服务。</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 22 }}>
            <div className="image-confirm-stat"><span>模型</span><strong>{imageModelLabel(confirmTarget.model)}</strong></div>
            <div className="image-confirm-stat"><span>尺寸</span><strong>{size}</strong></div>
            <div className="image-confirm-stat"><span>参考图</span><strong>{taskReferenceCount(confirmTarget)} 张</strong></div>
          </div>
          <div style={{ marginTop: 15, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.045)", border: "1px solid var(--stroke)", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.7 }}>
            实际费用以 Wetoken 账单为准。确认后不可撤销，失败或状态未知时请先查看任务历史。
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 22 }}>
            <button type="button" disabled={phase === "confirming"} onClick={() => { setConfirmTarget(null); setPhase("idle"); setNotice("已取消确认，草稿仍保留在历史中。"); }} style={{ height: 40, padding: "0 16px", borderRadius: 11, border: "1px solid var(--stroke-2)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }}>稍后确认</button>
            <button type="button" disabled={phase === "confirming"} onClick={() => void confirmTargetTask()} style={{ height: 40, padding: "0 18px", borderRadius: 11, border: 0, background: "var(--accent)", color: "var(--accent-ink)", cursor: phase === "confirming" ? "wait" : "pointer", fontWeight: 700 }}>{phase === "confirming" ? "确认提交中…" : "确认并生成"}</button>
          </div>
        </section>
      );
    }
    if (loadingHistory || phase === "preparing" || phase === "confirming") {
      return <div className="image-state-card" role="status"><div className="image-spinner" /><h1>{phase === "preparing" ? "准备参考图…" : phase === "confirming" ? "确认提交中…" : "加载任务历史…"}</h1><p>只会在明确操作后继续下一步。</p></div>;
    }
    if (phase === "error" && error) {
      return <div className="image-state-card image-state-error" role="alert"><div className="image-state-mark">!</div><h1>这次没有生成</h1><p>{error}</p><button type="button" onClick={() => { setPhase("idle"); setError(""); }}>返回编辑</button></div>;
    }
    if (selectedTask && (selectedTask.status === "submitting" || selectedTask.status === "queued" || selectedTask.status === "running" || selectedTask.status === "unknown")) {
      return <div className="image-state-card image-state-pending" role="status"><div className="image-state-mark"><Icon d={I.refresh} size={22} /></div><h1>{selectedTask.status === "unknown" ? "任务状态未知" : "任务正在路上"}</h1><p>{notice || "正在等待服务端状态。刷新只读取任务列表，不会自动确认。"}</p><button type="button" onClick={() => void refreshHistory(selectedTask.id)}><Icon d={I.refresh} size={14} />刷新任务状态</button></div>;
    }
    if (selectedTask?.status === "failed" || selectedTask?.status === "expired") {
      return <div className="image-state-card image-state-error" role="alert"><div className="image-state-mark">!</div><h1>生成未完成</h1><p>{selectedTask.error || "任务失败或已过期；不会自动重试。"}</p><button type="button" onClick={() => { setSelectedTaskId(null); setPhase("idle"); }}>开始新的草稿</button></div>;
    }
    if (selectedTask?.status === "succeeded" && selectedTask.resultUrl) {
      return <section className="image-result-card" aria-labelledby="image-result-title"><div className="image-result-head"><div><div className="fg-mono image-kicker">PRIVATE RESULT</div><h1 id="image-result-title">生成结果</h1></div><span className="image-status-chip"><Icon d={I.check} size={13} />已完成</span></div><div className="image-result-frame"><img src={selectedTask.resultUrl} alt="独立生图结果" /></div>{selectedTask.referenceUrls.length > 0 && <div className="image-result-references" aria-label="参考图"><span className="fg-mono">REFERENCES</span>{selectedTask.referenceUrls.map((url, index) => <img key={url} src={url} alt={`参考图 ${index + 1}`} />)}</div>}<div className="image-result-meta"><span>{imageModelLabel(selectedTask.model)}</span><span>{taskSize(selectedTask)}</span><span>{taskReferenceCount(selectedTask)} 张参考图</span></div><div className="image-result-actions"><a href={selectedTask.resultUrl} download={`creator-image-${selectedTask.id}.${resultFileExtension(selectedTask)}`} target="_blank" rel="noreferrer"><Icon d={I.download} size={15} />下载原图</a><button type="button" onClick={() => void copyPrompt()}><Icon d={I.copy} size={15} />复制提示词</button><button type="button" onClick={reuseParameters}><Icon d={I.refresh} size={15} />复用参数</button><button type="button" onClick={(event) => openDeleteModal(selectedTask, event.currentTarget)} className="danger"><Icon d={I.trash} size={15} />删除结果</button></div></section>;
    }
    if (selectedTask?.status === "succeeded") {
      return <div className="image-state-card" role="status"><div className="image-state-mark"><Icon d={I.check} size={22} /></div><h1>结果已完成</h1><p>结果链接正在刷新，请重新读取历史列表。</p><button type="button" onClick={() => void refreshHistory(selectedTask.id)}><Icon d={I.refresh} size={14} />刷新结果</button></div>;
    }
    return <div className="image-empty-state"><div className="image-empty-orbit"><Icon d={I.spark} size={28} /></div><div className="fg-mono image-kicker">FG STUDIO · IMAGE CONTROL ROOM</div><h1>把一帧画面，交给明确的确认。</h1><p>在右侧准备模型、比例、参考图与 Prompt。提交前会先保存草稿，只有你确认后才会调用一次生成服务。</p><div className="image-empty-note"><span>01</span><span>草稿和上传分离保存</span><span>02</span><span>确认卡显示预计尺寸</span><span>03</span><span>历史结果可复用</span></div></div>;
  };

  return (
    <div data-theme={theme} className="fg2 image-workspace" style={{ minHeight: "100vh", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", color: "var(--text)" }}>
      <div className="image-backdrop" />
      <header className="image-workspace-header">
        <div className="fg-mono image-logo">FG</div>
        <div><div className="image-title">AI 创作台</div><div className="fg-mono image-subtitle">STANDALONE IMAGE · PRIVATE</div></div>
        <div className="image-header-divider" />
        <span className="image-header-context">独立生图</span>
        <div style={{ flex: 1 }} />
        <a href="/creator" className="image-header-link"><Icon d={I.back} size={15} />返回对话</a>
        <Hov as="button" aria-label="切换主题" onClick={toggle} base={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }} hover={{ background: "var(--panel-2)", color: "var(--text)" }}><span style={{ fontSize: 15 }}>{theme === "dark" ? "☼" : "☾"}</span></Hov>
        <div className="fg-mono image-avatar">{me}</div>
      </header>

      <div className="image-workspace-grid" style={{ "--image-control-width": controlPanelWidth + "px" } as CSSProperties}>
        <aside className="image-sidebar image-sidebar-left">
          <button type="button" onClick={clearComposer} className="image-new-button"><Icon d={I.plus} size={16} sw={2} />新草稿</button>
          <div className="image-mode-list" aria-label="创作模式">
            <a href="/creator" className="image-mode-link"><Icon d={I.chat} size={16} />对话</a>
            <a href="/creator/image" aria-current="page" className="image-mode-link active"><Icon d={I.image} size={16} />独立生图<span className="image-mode-dot" /></a>
            <button type="button" disabled className="image-mode-link disabled"><Icon d={I.video} size={16} />视频画布<span className="image-coming">即将接入</span></button>
          </div>
          <div className="fg-mono image-section-label">任务历史</div>
          <div className="image-history-list">{loadingHistory && !tasks.length ? <div className="image-history-loading">读取中…</div> : historyRows.length ? historyRows : <div className="image-history-empty">确认后的任务会留在这里。</div>}</div>
          <div className="image-sidebar-note"><span className="fg-mono">SAFE COMMIT</span><br />媒体生成始终先保存草稿，再由你明确确认；历史费用账本不会随删除移除。</div>
        </aside>

        <main className="image-canvas-column">
          <div className="image-canvas-toolbar"><div><div className="fg-mono image-kicker">CANVAS / {selectedTask ? statusLabel(selectedTask.status).toUpperCase() : "EMPTY"}</div><h2>生成画布</h2></div>{notice && <div className="image-notice" role="status">{notice}</div>}<button type="button" className="image-mobile-controls-toggle" aria-expanded={mobileControlsOpen} aria-controls="image-control-panel" onClick={() => setMobileControlsOpen((open) => !open)}>{mobileControlsOpen ? "收起参数" : "打开参数"}<Icon d={I.plus} size={14} /></button></div>
          <div className="image-canvas-scroll">
            <div className="image-canvas-board" aria-label="Image generation canvas">
              <div className="image-canvas-board-header"><div><div className="fg-mono image-kicker">IMAGE CANVAS</div><strong>STAGE / {selectedTask ? statusLabel(selectedTask.status).toUpperCase() : "EMPTY"}</strong></div><span className="image-canvas-board-hint">PRIMARY GENERATION SURFACE</span></div>
              <div className="image-canvas-board-content">{renderCenter()}{selectedTask && selectedTask.resultUrl && <button type="button" className="image-canvas-preview-button" onClick={() => setPreviewOpen(true)} aria-label="Open full-size preview"><Icon d={I.expand} size={15} />{"\u5927\u5c4f\u9884\u89c8"}</button>}</div>
            </div>
          </div>
        </main>

        <button type="button" className="image-panel-resizer" role="separator" aria-orientation="vertical" aria-valuemin={IMAGE_PANEL_MIN_WIDTH} aria-valuemax={IMAGE_PANEL_MAX_WIDTH} aria-valuenow={controlPanelWidth} aria-valuetext={controlPanelWidth + "px"} onPointerDown={beginControlPanelResize} onKeyDown={onControlPanelResizeKeyDown} title="Resize control panel"><span /></button>
        <aside id="image-control-panel" className={"image-sidebar image-sidebar-right" + (mobileControlsOpen ? " mobile-open" : "")}>
          <button type="button" className="image-mobile-controls-handle" aria-expanded={mobileControlsOpen} aria-controls="image-control-panel" onClick={() => setMobileControlsOpen((open) => !open)}><span>参数面板</span><span>{mobileControlsOpen ? "收起" : "展开"}</span></button><div className="image-control-heading"><div><div className="fg-mono image-kicker">CONTROL SURFACE</div><h2>生成参数</h2></div><div className="image-control-heading-actions"><span className="image-dim-label">{sizeFor(model, ratio)}</span><button type="button" className="image-panel-reset" onClick={() => updateControlPanelWidth(IMAGE_PANEL_DEFAULT_WIDTH)} aria-label="Reset control panel width" title="Reset width"><Icon d={I.refresh} size={13} /></button></div></div>
          <div className="image-control-scroll">
            <label className="image-field-label" htmlFor="image-model">模型</label>
            <select id="image-model" className="image-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={!!confirmTarget || phase === "preparing" || phase === "confirming"}>{IMG_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}{item.experimental ? " · 实验" : ""}</option>)}</select>
            <div className="image-field-label">比例 / 输出尺寸</div>
            <div className="image-ratio-grid">{RATIOS.map((item) => <button type="button" key={item.key} onClick={() => setRatio(item.key)} aria-pressed={item.key === ratio} disabled={!!confirmTarget || phase === "preparing" || phase === "confirming"} className={item.key === ratio ? "active" : ""}>{item.key}<small>{sizeFor(model, item.key)}</small></button>)}</div>

            <div className="image-field-label image-reference-label"><span>参考图</span><span>{files.length}/{MAX_CREATOR_IMAGE_REFERENCES}</span></div>
            <label htmlFor="creator-image-files" className="image-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onKeyDown={onDropzoneKeyDown} tabIndex={0} role="button" aria-label="拖放或选择参考图"><Icon d={I.upload} size={20} /><strong>拖放或选择参考图</strong><span>JPEG / PNG / WebP · 单张 ≤ 7MB · 总计 ≤ 28MB</span><input ref={fileInputRef} id="creator-image-files" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFileChange} disabled={files.length >= MAX_CREATOR_IMAGE_REFERENCES || !!confirmTarget} /></label>
            {previews.length > 0 && <div className="image-reference-grid">{previews.map(({ file, url }, index) => <div className="image-reference-thumb" key={`${file.name}-${file.lastModified}-${index}`} draggable={!confirmTarget} role="group" aria-label={`Reference image ${index + 1}: ${file.name}`} style={{ opacity: dragIndex === index ? 0.65 : 1 }} onDragStart={(event) => onReferenceDragStart(event, index)} onDragEnd={onReferenceDragEnd} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onReferenceDrop(event, index)}><img src={url} alt={file.name} /><button type="button" aria-label={`删除参考图 ${file.name}`} disabled={!!confirmTarget} onClick={() => removeFile(index)}><Icon d={I.close} size={12} /></button><span>{index + 1}</span></div>)}</div>}

            <div className="image-picker-row"><SkillPicker active={activeSkill?.name || null} onApply={(name, content) => setActiveSkill({ name, content })} onClear={() => setActiveSkill(null)} /><PromptPicker onInsert={(text) => setPrompt((current) => current.trim() ? `${current.trimEnd()}\n${text}` : text)} /></div>
            <label className="image-field-label" htmlFor="creator-image-prompt">Prompt</label>
            <textarea id="creator-image-prompt" className="image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述主体、构图、光线、材质与情绪…" disabled={!!confirmTarget || phase === "preparing" || phase === "confirming"} />
            <div className="image-prompt-meta"><span>{activeSkill ? `Skill · ${activeSkill.name}` : "未启用 Skill"}</span><span>{prompt.length}/30k</span></div>
          </div>
          <div className="image-generate-footer"><button type="button" className="image-generate-button" onClick={() => void prepareDraft()} disabled={!!confirmTarget || phase === "preparing" || phase === "confirming" || !prompt.trim()}><Icon d={I.spark} size={16} />{phase === "preparing" ? "准备中…" : "生成 1 张"}</button><div className="image-generate-footnote">会先建立草稿；确认卡出现后才会产生调用。</div></div>
        </aside>
      </div>

      {previewOpen && selectedTask && selectedTask.resultUrl && <div className="image-preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
        <div className="image-preview-modal" role="dialog" aria-modal="true" aria-labelledby="image-preview-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="image-preview-header">
            <div><div className="fg-mono image-kicker">FULL FRAME PREVIEW</div><h2 id="image-preview-title">{"\u5927\u5c4f\u9884\u89c8"}</h2></div>
            <button type="button" className="image-preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><Icon d={I.close} size={16} />{"\u5173\u95ed"}</button>
          </div>
          <div className="image-preview-stage"><img src={selectedTask.resultUrl} alt="Generated image full-screen preview" /></div>
          <div className="image-preview-footer"><span>{imageModelLabel(selectedTask.model)} / {taskSize(selectedTask)}</span><a href={selectedTask.resultUrl} download={"creator-image-" + selectedTask.id + "." + resultFileExtension(selectedTask)} target="_blank" rel="noreferrer"><Icon d={I.download} size={14} />{"\u4e0b\u8f7d\u539f\u56fe"}</a></div>
        </div>
      </div>}
      {deleteTarget && <div className="image-modal-backdrop" onMouseDown={closeDeleteModal}><div className="image-delete-modal" role="dialog" aria-modal="true" aria-labelledby="image-delete-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}><div className="image-delete-icon"><Icon d={I.trash} size={18} /></div><h2 id="image-delete-title">永久删除任务与结果？</h2><p>任务、生成结果和参考图文件会被永久删除，无法恢复。</p><p className="image-delete-warning">历史费用账本会保留，不会随删除移除。</p><div className="image-modal-actions"><button ref={deleteCancelRef} type="button" disabled={deleting} onClick={closeDeleteModal}>取消</button><button ref={deleteConfirmRef} type="button" disabled={deleting} onClick={() => void removeTask()} className="danger">{deleting ? "删除中…" : "永久删除"}</button></div></div></div>}

      <style jsx>{`
        .image-workspace { position: relative; isolation: isolate; }
        .image-backdrop { position: fixed; inset: 0; pointer-events: none; z-index: -1; background: radial-gradient(720px 520px at 100% 0%,var(--glow-coral),transparent 62%),radial-gradient(800px 600px at -10% 110%,var(--glow-b),transparent 60%); }
        .image-workspace-header { position: relative; z-index: 3; height: 60px; flex: none; display: flex; align-items: center; gap: 13px; padding: 0 18px; border-bottom: 1px solid var(--stroke); background: var(--panel); backdrop-filter: blur(24px) saturate(1.4); }
        .image-logo { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: linear-gradient(150deg,var(--accent),var(--accent-2)); color: var(--accent-ink); font-size: 12px; font-weight: 700; }
        .image-title { font-size: 14px; font-weight: 650; }
        .image-subtitle,.image-kicker { color: var(--text-3); font-size: 9px; letter-spacing: 1.1px; }
        .image-header-divider { width: 1px; height: 24px; margin-left: 5px; background: var(--stroke); }
        .image-header-context { color: var(--text-2); font-size: 12.5px; }
        .image-header-link { height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 12px; border: 1px solid var(--stroke); border-radius: 10px; color: var(--text-2); background: var(--panel); font-size: 12px; text-decoration: none; }
        .image-avatar { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: linear-gradient(150deg,var(--accent),var(--accent-2)); color: var(--accent-ink); font-size: 11px; font-weight: 700; }
        .image-workspace-grid { position: relative; z-index: 1; flex: 1; min-height: 0; display: grid; grid-template-columns: 248px minmax(360px,1fr) 12px var(--image-control-width); }
        .image-sidebar { min-height: 0; display: flex; flex-direction: column; padding: 12px; background: color-mix(in srgb,var(--panel) 86%,transparent); backdrop-filter: blur(20px); }
        .image-sidebar-left { border-right: 1px solid var(--stroke); }
        .image-sidebar-right { border-left: 1px solid var(--stroke); background: color-mix(in srgb,var(--panel-solid) 82%,transparent); backdrop-filter: none; -webkit-backdrop-filter: none; }        .image-panel-resizer { position: relative; z-index: 4; display: flex; align-items: center; justify-content: center; width: 12px; padding: 0; border: 0; border-right: 1px solid var(--stroke); border-left: 1px solid var(--stroke); background: color-mix(in srgb,var(--panel) 72%,transparent); color: var(--text-3); cursor: col-resize; }
        .image-panel-resizer::before { width: 3px; height: 48px; border-radius: 99px; background: currentColor; content: ""; opacity: .34; transition: height .2s ease,opacity .2s ease,background .2s ease; }
        .image-panel-resizer:hover,.image-panel-resizer:focus-visible { outline: none; color: var(--accent); background: var(--panel-2); }
        .image-panel-resizer:hover::before,.image-panel-resizer:focus-visible::before { height: 72px; opacity: .9; }
        .image-new-button { height: 42px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--user-stroke); border-radius: 12px; background: var(--user-bubble); color: var(--text); cursor: pointer; font-size: 13px; font-weight: 600; }
        .image-mode-list { display: grid; gap: 5px; margin-top: 10px; }
        .image-mode-link { position: relative; min-height: 42px; display: flex; align-items: center; gap: 9px; padding: 0 11px; border: 1px solid transparent; border-radius: 11px; background: transparent; color: var(--text-2); font-size: 12px; text-decoration: none; }
        .image-mode-link.active { border-color: var(--stroke-2); background: var(--panel-2); color: var(--accent); }
        .image-mode-link.disabled { color: var(--text-3); cursor: not-allowed; }
        .image-mode-dot { width: 5px; height: 5px; margin-left: auto; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
        .image-coming { margin-left: auto; font-size: 9px; color: var(--text-3); }
        .image-section-label { padding: 22px 9px 7px; color: var(--text-3); font-size: 9.5px; letter-spacing: 1.4px; }
        .image-history-list { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }
        .image-history-loading,.image-history-empty { padding: 12px 9px; color: var(--text-3); font-size: 11px; line-height: 1.6; }
        .image-sidebar-note { margin-top: 12px; padding: 10px 11px; border: 1px solid var(--stroke); border-radius: 11px; background: var(--panel); color: var(--text-3); font-size: 11px; line-height: 1.6; }
        .image-sidebar-note .fg-mono { color: var(--accent); font-size: 9px; letter-spacing: 1px; }
        .image-canvas-column { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
        .image-canvas-toolbar,.image-control-heading { min-height: 70px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--stroke); }
        .image-canvas-toolbar h2,.image-control-heading h2 { margin: 3px 0 0; font-size: 14px; font-weight: 650; }
        .image-notice { max-width: 52%; color: var(--text-2); font-size: 11px; line-height: 1.5; text-align: right; }
        .image-canvas-scroll { position: relative; flex: 1; min-height: 0; display: flex; overflow: auto; padding: clamp(16px,2.4vw,30px); background: linear-gradient(rgba(116,240,142,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(116,240,142,.035) 1px,transparent 1px),var(--bg); background-size: 32px 32px; }        .image-canvas-board { position: relative; width: min(1160px,100%); min-height: min(720px,calc(100vh - 160px)); display: flex; flex-direction: column; margin: auto; overflow: hidden; border: 1px solid var(--stroke-2); border-radius: 24px; background: radial-gradient(700px 420px at 50% 0%,var(--glow-a),transparent 68%),color-mix(in srgb,var(--panel) 88%,transparent); box-shadow: var(--shadow),inset 0 1px 0 rgba(255,255,255,.08); }
        .image-canvas-board::after { position: absolute; inset: 0; z-index: 0; pointer-events: none; content: ""; background: radial-gradient(circle at 50% 45%,transparent 0 35%,rgba(4,8,18,.08) 72%); }
        .image-canvas-board-header { position: relative; z-index: 1; min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 17px; border-bottom: 1px solid var(--stroke); background: color-mix(in srgb,var(--panel-solid) 44%,transparent); }
        .image-canvas-board-header strong { display: block; margin-top: 4px; color: var(--text-2); font-family: "JetBrains Mono",monospace; font-size: 10px; letter-spacing: .6px; }
        .image-canvas-board-hint { color: var(--text-3); font-family: "JetBrains Mono",monospace; font-size: 9px; letter-spacing: .7px; }
        .image-canvas-board-content { position: relative; z-index: 1; flex: 1; min-height: 0; display: flex; overflow: auto; padding: clamp(18px,3vw,42px); }
        .image-canvas-board-content > * { margin-top: auto; margin-bottom: auto; }
        .image-empty-state,.image-state-card,.image-result-card { width: min(850px,100%); margin: auto; }
        .image-empty-state { padding: 25px; text-align: center; }
        .image-empty-orbit { width: 68px; height: 68px; display: grid; place-items: center; margin: 0 auto 20px; border: 1px solid var(--user-stroke); border-radius: 22px; background: linear-gradient(145deg,var(--user-bubble),var(--panel-2)); color: var(--accent); box-shadow: 0 24px 60px -30px var(--accent); }
        .image-empty-state h1 { max-width: 590px; margin: 17px auto 10px; font-size: clamp(24px,3vw,34px); letter-spacing: -.8px; }
        .image-empty-state p { max-width: 570px; margin: 0 auto; color: var(--text-2); font-size: 13.5px; line-height: 1.85; }
        .image-empty-note { display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 8px 10px; max-width: 630px; margin: 30px auto 0; padding: 12px 15px; border: 1px solid var(--stroke); border-radius: 12px; background: var(--panel); color: var(--text-2); text-align: left; font-size: 11px; }
        .image-empty-note span:nth-child(odd) { color: var(--accent); font-family: "JetBrains Mono",monospace; }
        .image-state-card { max-width: 480px; padding: 28px; border: 1px solid var(--stroke); border-radius: 20px; background: var(--panel); text-align: center; box-shadow: var(--shadow); }
        .image-state-card h1 { margin: 15px 0 7px; font-size: 20px; }
        .image-state-card p { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.7; }
        .image-state-card button { display: inline-flex; align-items: center; gap: 7px; height: 36px; margin-top: 18px; padding: 0 13px; border: 1px solid var(--stroke-2); border-radius: 10px; background: var(--panel-2); color: var(--text); cursor: pointer; font-size: 12px; }
        .image-state-mark { width: 44px; height: 44px; display: grid; place-items: center; margin: 0 auto; border-radius: 14px; background: var(--user-bubble); color: var(--accent); }
        .image-state-error .image-state-mark { background: rgba(255,119,89,.12); color: #ff9b85; }
        .image-state-error h1 { color: #ffb0a0; }
        .image-spinner { width: 28px; height: 28px; margin: 0 auto 14px; border: 2px solid var(--stroke-2); border-top-color: var(--accent); border-radius: 50%; animation: image-spin .9s linear infinite; }
        @keyframes image-spin { to { transform: rotate(360deg); } }
        .image-result-card { padding: 6px 0 18px; }
        .image-result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
        .image-result-head h1 { margin: 5px 0 0; font-size: 22px; }
        .image-status-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 1px solid var(--user-stroke); border-radius: 999px; color: var(--accent); font-size: 11px; }
        .image-result-frame { width: 100%; display: block; padding: 0; overflow: hidden; border: 1px solid var(--stroke-2); border-radius: 18px; background: var(--panel); box-shadow: var(--shadow); cursor: zoom-in; text-align: left; } .image-result-frame:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
        .image-result-frame img { display: block; width: 100%; max-height: min(64vh,680px); object-fit: contain; background: rgba(0,0,0,.18); }        .image-canvas-preview-button { position: absolute; right: clamp(28px,4vw,58px); bottom: clamp(28px,4vw,58px); z-index: 5; display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 13px; border: 1px solid var(--user-stroke); border-radius: 11px; background: var(--panel-solid); color: var(--accent); box-shadow: 0 12px 32px rgba(0,0,0,.25); cursor: pointer; font-size: 11.5px; }
        .image-canvas-preview-button:hover { border-color: var(--accent); background: var(--panel-2); transform: translateY(-1px); }
        .image-preview-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: clamp(14px,3vw,42px); background: rgba(4,8,18,.78); backdrop-filter: blur(18px) saturate(1.3); }
        .image-preview-modal { width: min(1480px,100%); height: min(900px,100%); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--stroke-2); border-radius: 22px; background: var(--panel-solid); box-shadow: 0 36px 110px rgba(0,0,0,.55); }
        .image-preview-header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--stroke); }
        .image-preview-header h2 { margin: 4px 0 0; font-size: 17px; }
        .image-preview-close { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px; border: 1px solid var(--stroke); border-radius: 9px; background: var(--panel); color: var(--text-2); cursor: pointer; font-size: 11px; }
        .image-preview-close:hover,.image-preview-close:focus-visible { border-color: var(--stroke-2); color: var(--text); outline: none; }
        .image-preview-stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: auto; padding: clamp(16px,3vw,40px); background: radial-gradient(circle at 50% 42%,rgba(116,240,142,.08),transparent 48%),#050812; }
        .image-preview-stage img { display: block; width: auto; max-width: 100%; height: auto; max-height: 100%; object-fit: contain; border-radius: 10px; box-shadow: 0 20px 70px rgba(0,0,0,.38); }
        .image-preview-footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 20px; border-top: 1px solid var(--stroke); color: var(--text-3); font-family: "JetBrains Mono",monospace; font-size: 10px; }
        .image-preview-footer a { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); text-decoration: none; }
        .image-preview-footer a:hover { color: var(--text); }
        .image-result-references { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding: 9px 2px 2px; }
        .image-result-references .fg-mono { margin-right: 3px; color: var(--text-3); font-size: 9px; letter-spacing: 1px; }
        .image-result-references img { width: 38px; height: 38px; flex: none; border: 1px solid var(--stroke); border-radius: 7px; object-fit: cover; }
        .image-result-meta { display: flex; flex-wrap: wrap; gap: 7px 16px; padding: 11px 2px; color: var(--text-3); font-family: "JetBrains Mono",monospace; font-size: 10px; }
        .image-result-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .image-result-actions a,.image-result-actions button { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px; border: 1px solid var(--stroke); border-radius: 9px; background: var(--panel); color: var(--text-2); cursor: pointer; font-size: 11.5px; text-decoration: none; }
        .image-result-actions a:hover,.image-result-actions button:hover { border-color: var(--stroke-2); color: var(--text); background: var(--panel-2); }
        .image-result-actions .danger,.image-modal-actions .danger { color: #ff9b85; }
        .image-control-heading { padding: 0 16px; } .image-control-heading-actions { display: flex; align-items: center; gap: 7px; } .image-panel-reset { width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid var(--stroke); border-radius: 7px; background: transparent; color: var(--text-3); cursor: pointer; } .image-panel-reset:hover,.image-panel-reset:focus-visible { border-color: var(--stroke-2); color: var(--accent); outline: none; }
        .image-dim-label { color: var(--text-3); font-family: "JetBrains Mono",monospace; font-size: 10px; }
        .image-control-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 17px 16px 8px; }
        .image-field-label { display: flex; align-items: center; justify-content: space-between; margin: 0 0 7px; color: var(--text-3); font-family: "JetBrains Mono",monospace; font-size: 10px; letter-spacing: .6px; text-transform: uppercase; }
        .image-select { width: 100%; height: 40px; margin-bottom: 18px; padding: 0 10px; border: 1px solid var(--stroke); border-radius: 10px; outline: none; background: var(--panel); color: var(--text); font: inherit; font-size: 12px; }
        .image-select:focus,.image-prompt:focus { border-color: var(--stroke-2); }
        .image-ratio-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 5px; margin-bottom: 19px; }
        .image-ratio-grid button { min-height: 43px; padding: 4px 2px; border: 1px solid var(--stroke); border-radius: 9px; background: var(--panel); color: var(--text-2); cursor: pointer; font-family: "JetBrains Mono",monospace; font-size: 10px; }
        .image-ratio-grid button small { display: block; margin-top: 3px; color: var(--text-3); font-size: 8px; }
        .image-ratio-grid button.active { border-color: var(--user-stroke); background: var(--user-bubble); color: var(--accent); }
        .image-reference-label { margin-bottom: 7px; }
        .image-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 104px; gap: 7px; padding: 14px; border: 1px dashed var(--stroke-2); border-radius: 13px; background: var(--panel); color: var(--text-2); cursor: pointer; text-align: center; }
        .image-dropzone:hover,.image-dropzone:focus-visible { border-color: var(--accent); outline: none; background: var(--panel-2); }
        .image-dropzone svg { color: var(--accent); }
        .image-dropzone strong { font-size: 12px; font-weight: 600; }
        .image-dropzone span { color: var(--text-3); font-size: 10px; }
        .image-dropzone input { display: none; }
        .image-reference-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; margin: 9px 0 17px; }
        .image-reference-thumb { position: relative; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--stroke); border-radius: 8px; background: var(--panel); }
        .image-reference-thumb img { width: 100%; height: 100%; display: block; object-fit: cover; }
        .image-reference-thumb button { position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; display: grid; place-items: center; border: 0; border-radius: 6px; background: rgba(5,7,9,.72); color: #fff; cursor: pointer; }
        .image-reference-thumb span { position: absolute; bottom: 3px; left: 4px; padding: 1px 4px; border-radius: 4px; background: rgba(5,7,9,.72); color: #fff; font-family: "JetBrains Mono",monospace; font-size: 8px; }
        .image-picker-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
        .image-picker-row :global(button) { min-height: 29px; }
        .image-prompt { width: 100%; min-height: 148px; resize: vertical; padding: 11px 12px; border: 1px solid var(--stroke); border-radius: 11px; outline: none; background: var(--panel); color: var(--text); font: inherit; font-size: 12.5px; line-height: 1.7; }
        .image-prompt::placeholder { color: var(--text-3); }
        .image-prompt-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--text-3); font-size: 10px; }
        .image-generate-footer { flex: none; padding: 12px 16px 15px; border-top: 1px solid var(--stroke); background: var(--panel); }
        .image-generate-button { width: 100%; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-ink); cursor: pointer; font-size: 13px; font-weight: 700; }
        .image-generate-button:disabled { cursor: not-allowed; opacity: .42; }
        .image-generate-footnote { margin-top: 7px; color: var(--text-3); font-size: 10px; text-align: center; }
        .image-modal-backdrop { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(5,7,9,.62); backdrop-filter: blur(8px); }
        .image-delete-modal { width: min(430px,100%); padding: 23px; border: 1px solid var(--stroke-2); border-radius: 18px; background: var(--panel-solid); box-shadow: 0 28px 90px rgba(0,0,0,.48); }
        .image-delete-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; background: rgba(255,111,91,.12); color: #ff8d7c; }
        .image-delete-modal h2 { margin: 16px 0 8px; font-size: 18px; }
        .image-delete-modal p { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.7; }
        .image-delete-modal .image-delete-warning { margin-top: 7px; color: #ff9b85; font-size: 12px; }
        .image-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 22px; }
        .image-modal-actions button { height: 38px; padding: 0 15px; border: 1px solid var(--stroke); border-radius: 10px; background: var(--panel); color: var(--text-2); cursor: pointer; font-size: 12px; }
        .image-modal-actions .danger { border: 0; background: #e65f4c; color: #fff; font-weight: 650; }
        .image-mobile-controls-toggle,.image-mobile-controls-handle { display: none; }
        @media (max-width: 1200px) { .image-workspace-grid { grid-template-columns: 220px minmax(0,1fr) 12px min(38vw,var(--image-control-width)); } }
        @media (max-width: 900px) {
          .image-workspace { height: 100vh !important; min-height: 100vh; overflow: hidden !important; }
          .image-workspace-grid { grid-template-columns: 1fr; min-height: 0; }
          .image-panel-resizer { display: none; }
          .image-sidebar-left { min-height: auto; border: 0; }
          .image-history-list { max-height: 180px; }
          .image-canvas-column { min-height: 0; height: 100%; order: 2; }
          .image-canvas-scroll { min-height: 0; padding-bottom: 90px; }
          .image-canvas-board { min-height: calc(100vh - 150px); }
          .image-notice { max-width: 48%; }
          .image-mobile-controls-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px; padding: 0 9px; border: 1px solid var(--stroke-2); border-radius: 9px; background: var(--panel-2); color: var(--text-2); cursor: pointer; font-size: 10px; }
          .image-sidebar-right { position: fixed; z-index: 20; left: 10px; right: 10px; bottom: 0; order: initial; min-height: 0; max-height: min(78vh,720px); border: 1px solid var(--stroke-2); border-bottom: 0; border-radius: 18px 18px 0 0; box-shadow: 0 -20px 70px rgba(0,0,0,.35); overflow: hidden; transform: translateY(calc(100% - 58px)); transition: transform .24s ease; }
          .image-sidebar-right.mobile-open { transform: translateY(0); }
          .image-mobile-controls-handle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 58px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--stroke); background: var(--panel); color: var(--text); cursor: pointer; font-size: 12px; font-weight: 650; }
          .image-mobile-controls-handle span:last-child { color: var(--accent); font-family: "JetBrains Mono",monospace; font-size: 9px; letter-spacing: .8px; }
          .image-sidebar-right .image-control-heading { min-height: 60px; }
          .image-sidebar-right .image-control-scroll { max-height: calc(78vh - 170px); overflow-y: auto; }
        }
        @media (max-width: 560px) {
          .image-sidebar-right { left: 0; right: 0; border-radius: 16px 16px 0 0; }
          .image-workspace-header { padding: 0 12px; gap: 9px; }
          .image-header-context,.image-header-link span { display: none; }
          .image-header-divider { display: none; }
          .image-avatar { margin-left: 2px; }
          .image-canvas-toolbar { padding: 0 15px; }
          .image-canvas-scroll { padding: 15px; }
          .image-empty-note { grid-template-columns: auto 1fr; }
          .image-confirm-card { padding: 21px !important; }
          .image-confirm-card > div:nth-of-type(2) { grid-template-columns: 1fr !important; }
          .image-result-actions a,.image-result-actions button { flex: 1 1 calc(50% - 8px); justify-content: center; }
        }
      `}</style>
    </div>
  );
}
