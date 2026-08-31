"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type UIEvent } from "react";
import { ArrowDown, Bot, ChevronDown, Clapperboard, MessageSquarePlus, Paperclip, Send, Sparkles, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { DEFAULT_TEXT_MODEL_ID, isTextModelId, TEXT_MODELS } from "@/lib/ai/catalog";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "@/lib/ai/reasoning";
import { isConversationNearBottom } from "@/lib/creator/history";
import type { CreatorMessage, CreatorSession } from "@/lib/creator/types";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { CanvasNodeType } from "@/reference/infinite-canvas/src/types/canvas";
import { type CanvasAgentOp } from "@/reference/infinite-canvas/src/lib/canvas/canvas-agent-ops";
import { imageMetadata, videoMetadata, audioMetadata } from "@/reference/infinite-canvas/src/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/reference/infinite-canvas/src/services/image-storage";
import { uploadMediaFile } from "@/reference/infinite-canvas/src/services/file-storage";
import { useAgentStore } from "@/reference/infinite-canvas/src/stores/use-agent-store";
import { CompanyVideoSkillFlow, type CompanyVideoSkillFlowInput } from "./company-video-skill-flow";

type Props = { embedded?: boolean };
type ActiveSkill = { name: string; content: string };
type ErrorPayload = { error?: string; traceId?: string };

async function readAgentResponse<T>(response: Response, fallback: string): Promise<T> {
  let data: (T & ErrorPayload) | null = null;
  try {
    data = await response.json() as T & ErrorPayload;
  } catch {
    // The local reverse proxy can return a non-JSON error page; preserve its HTTP trace below.
  }
  if (!response.ok) {
    const traceId = response.headers.get("x-fg-trace-id") || data?.traceId;
    const message = data?.error || fallback;
    throw new Error(traceId ? `${message}（追踪编号：${traceId.slice(0, 8)}）` : message);
  }
  return (data || {}) as T;
}

function textOf(message: CreatorMessage) {
  return typeof message.content?.text === "string" ? message.content.text : "";
}

function dedupeMessages(items: CreatorMessage[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id || `${item.role}:${item.created_at}:${textOf(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function LocalAgentPanel({ embedded: _embedded }: Props) {
  const [sessions, setSessions] = useState<CreatorSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CreatorMessage[]>([]);
  const [model, setModel] = useState(DEFAULT_TEXT_MODEL_ID);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [skill, setSkill] = useState<ActiveSkill | null>(null);
  const [thinking, setThinking] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("auto");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [skillVideoOpen, setSkillVideoOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const followMessagesRef = useRef(true);
  const canvasContext = useAgentStore((state) => state.canvasContext);
  const selectedModel = useMemo(() => TEXT_MODELS.find((item) => item.id === model) || TEXT_MODELS[0], [model]);

  useEffect(() => { void loadSessions(); }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !followMessagesRef.current) return;
    requestAnimationFrame(() => viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" }));
  }, [messages, busy]);

  async function loadSessions(preferred?: string | null) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/creator/sessions?kind=chat", { cache: "no-store" });
      const data = await readAgentResponse<{ sessions: CreatorSession[] }>(response, "读取 Agent 会话失败");
      const next = (data.sessions || []).filter((item: CreatorSession) => item.kind === "chat") as CreatorSession[];
      setSessions(next);
      const id = preferred || sessionId || next[0]?.id || null;
      if (id) await openSession(id, next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取 Agent 会话失败"); }
    finally { setLoading(false); }
  }

  async function openSession(id: string, knownSessions = sessions) {
    try {
      const response = await fetch(`/api/creator/sessions?kind=chat&sessionId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await readAgentResponse<{ sessions: CreatorSession[]; messages: CreatorMessage[] }>(response, "读取会话失败");
      setSessions((data.sessions || knownSessions) as CreatorSession[]);
      setSessionId(id);
      setMessages(dedupeMessages((data.messages || []) as CreatorMessage[]));
      followMessagesRef.current = true;
      setShowScrollToLatest(false);
      const active = (data.sessions || knownSessions).find((item: CreatorSession) => item.id === id);
      if (isTextModelId(active?.default_model)) setModel(active.default_model);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取会话失败"); }
  }

  async function createSession() {
    const response = await fetch("/api/creator/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "chat", model }) });
    const data = await readAgentResponse<{ session: CreatorSession }>(response, "创建会话失败");
    setSessions((current) => [data.session, ...current]);
    setSessionId(data.session.id);
    setMessages([]);
    setHistoryOpen(false);
    followMessagesRef.current = true;
    return data.session.id as string;
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && !images.length) || busy) return;
    if (images.length && !selectedModel.supportsImages) { setError("当前文本模型不支持图片输入，请选择支持视觉的模型。"); return; }
    setBusy(true); setError(""); followMessagesRef.current = true;
    try {
      const activeId = sessionId || await createSession();
      const optimistic: CreatorMessage = { id: `local-${Date.now()}`, session_id: activeId, role: "user", content: { text, images }, status: "complete", created_at: new Date().toISOString() };
      setMessages((current) => dedupeMessages([...current, optimistic])); setPrompt(""); setImages([]);
      const response = await fetch("/api/creator/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: activeId, message: text || "请分析这些参考图。", model, thinking: thinking || reasoningEffort !== "auto", reasoningEffort, images, skill }) });
      const data = await readAgentResponse<{ message: CreatorMessage; title: string; model: string }>(response, "Agent 回复失败");
      setMessages((current) => dedupeMessages([...current, data.message as CreatorMessage]));
      setSessions((current) => current.map((item) => item.id === activeId ? { ...item, title: data.title, default_model: data.model, updated_at: new Date().toISOString() } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent 回复失败"); }
    finally { setBusy(false); }
  }

  async function deleteSession(id: string) {
    try {
      const response = await fetch(`/api/creator/sessions?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" });
      await readAgentResponse<ErrorPayload>(response, "删除会话失败");
      const remaining = sessions.filter((item) => item.id !== id); setSessions(remaining);
      if (id === sessionId) { setSessionId(null); setMessages([]); if (remaining[0]) await openSession(remaining[0].id, remaining); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除会话失败"); }
  }

  function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/")).slice(0, 4 - images.length);
    files.forEach((file) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" && setImages((current) => [...current, reader.result as string].slice(0, 4)); reader.readAsDataURL(file); });
    event.target.value = "";
  }

  function handleMessagesScroll(event: UIEvent<HTMLDivElement>) {
    const nearBottom = isConversationNearBottom(event.currentTarget);
    followMessagesRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  }

  function scrollToLatest() {
    followMessagesRef.current = true;
    setShowScrollToLatest(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }

  async function prepareSkillVideo(input: CompanyVideoSkillFlowInput) {
    if (!skill) throw new Error("请先选择一个 Skill");
    const response = await fetch("/api/creator/canvas-agent/video-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoningEffort,
        skill,
        brief: input.brief,
        subject: input.subject,
        visualDirection: input.visualDirection,
        ratio: input.ratio,
        duration: input.duration,
        referenceNames: input.references.map((file) => file.name),
      }),
    });
    const data = await readAgentResponse<{ prompt: string }>(response, "视频制作计划生成失败");
    if (!data.prompt?.trim()) throw new Error("模型没有返回可用的视频提示词");
    return data.prompt.trim();
  }

  async function startSkillVideo(input: CompanyVideoSkillFlowInput) {
    if (!skill) throw new Error("请先选择一个 Skill");
    if (!canvasContext) throw new Error("当前没有可执行的画布，请先打开一个画布项目。");
    const promptText = input.prompt.trim();
    if (!promptText) throw new Error("请先生成并确认制作提示词");

    const snapshot = canvasContext.snapshot;
    const selectedNode = snapshot.nodes.find((node) => snapshot.selectedNodeIds.includes(node.id));
    const anchor = selectedNode || snapshot.nodes.at(-1);
    const referenceX = (anchor?.position.x ?? 120) + (anchor?.width ?? 0) + 140;
    const referenceY = anchor?.position.y ?? 140;
    const uploadedReferences = await Promise.all(input.references.map(async (file, index) => {
      const id = nanoid();
      const position = { x: referenceX, y: referenceY + index * 260 };
      const title = file.name.slice(0, 72) || `参考素材 ${index + 1}`;
      if (file.type.startsWith("image/")) {
        const uploaded = await uploadImage(file);
        return { id, nodeType: CanvasNodeType.Image, title, position, metadata: imageMetadata(uploaded) };
      }
      if (file.type.startsWith("video/")) {
        const uploaded = await uploadMediaFile(file, "video");
        return { id, nodeType: CanvasNodeType.Video, title, position, metadata: videoMetadata(uploaded) };
      }
      if (file.type.startsWith("audio/")) {
        const uploaded = await uploadMediaFile(file, "audio");
        return { id, nodeType: CanvasNodeType.Audio, title, position, metadata: audioMetadata(uploaded) };
      }
      throw new Error(`暂不支持 ${file.name} 的文件类型`);
    }));
    const videoId = nanoid();
    const outputX = referenceX + (uploadedReferences.length ? 520 : 0);
    const outputY = referenceY + Math.max(0, (uploadedReferences.length - 1) * 130);
    const ops: CanvasAgentOp[] = [
      ...uploadedReferences.map((reference) => ({ type: "add_node" as const, id: reference.id, nodeType: reference.nodeType, title: reference.title, position: reference.position, metadata: reference.metadata })),
      {
        type: "add_node",
        id: videoId,
        nodeType: CanvasNodeType.Video,
        title: `${skill.name} · 视频制作`,
        position: { x: outputX, y: outputY },
        metadata: { composerContent: promptText, prompt: promptText, generationMode: "video", status: "idle", size: input.ratio, seconds: String(input.duration) },
      },
      ...uploadedReferences.map((reference) => ({ type: "connect_nodes" as const, fromNodeId: reference.id, toNodeId: videoId })),
      { type: "select_nodes", ids: [videoId] },
      { type: "run_generation", nodeId: videoId, mode: "video", prompt: promptText },
    ];
    console.info("[company agent Skill video production]", { projectId: snapshot.projectId, skill: skill.name, ratio: input.ratio, duration: input.duration, referenceCount: uploadedReferences.length });
    canvasContext.applyOps(ops);
  }

  if (skillVideoOpen && skill) {
    return <CompanyVideoSkillFlow skill={skill} modelLabel={selectedModel.label} canvasReady={Boolean(canvasContext)} onPrepare={prepareSkillVideo} onStart={startSkillVideo} onClose={() => setSkillVideoOpen(false)} />;
  }

  return (
    <section className="fg-agent-panel" aria-label="FG Agent 对话">
      <header className="fg-agent-header"><div className="fg-agent-title"><span className="fg-agent-icon"><Bot size={16} /></span><div><strong>画布创作顾问</strong><small>TEXT MODELS · PLAN / PROMPT / ANALYSIS</small></div></div><span className={`fg-agent-connection${error ? " fault" : ""}`} title={error ? "会话读取需要重试" : "本地会话已连接"}><i />{loading ? "同步中" : error ? "需重试" : "本地会话"}</span><button type="button" onClick={() => void createSession()} title="新对话"><MessageSquarePlus size={16} /></button><button type="button" onClick={() => setHistoryOpen((value) => !value)} title="历史会话"><ChevronDown size={historyOpen ? "rotate-180" : ""} /></button></header>
      {historyOpen ? <div className="fg-agent-history">{sessions.length ? sessions.slice(0, 20).map((item) => <div className={item.id === sessionId ? "fg-agent-history-row active" : "fg-agent-history-row"} key={item.id}><button type="button" onClick={() => void openSession(item.id)}><span>{item.title}</span><small>{new Date(item.updated_at).toLocaleDateString("zh-CN")}</small></button><button type="button" onClick={() => void deleteSession(item.id)} aria-label={`删除${item.title}`}><Trash2 size={13} /></button></div>) : <p>暂无历史对话</p>}</div> : null}
      <div className="fg-agent-message-wrap">
        <div ref={scrollRef} className="fg-agent-messages" onScroll={handleMessagesScroll}>
          {loading ? <div className="fg-agent-empty">正在加载对话…</div> : messages.length ? messages.map((message) => <article className={message.role === "user" ? "fg-agent-message user" : "fg-agent-message assistant"} key={message.id}><div className="fg-agent-message-role">{message.role === "user" ? "你" : "Agent"}</div><div className="fg-agent-message-text">{textOf(message)}</div>{message.content?.usage ? <small className="fg-agent-usage">{message.content.usage.total_tokens ? `${message.content.usage.total_tokens.toLocaleString()} tokens` : ""}</small> : null}</article>) : <div className="fg-agent-empty"><Sparkles size={22} /><strong>先把想法变成可执行方案</strong><span>可写提示词、拆解镜头、分析参考图和规划节点连接。</span><small className="fg-agent-scope-note">普通公司模型聊天不会直接改动画布；选择 Skill 后可进入受控的「视频制作」流程，确认开始后才会创建节点并生成。</small></div>}
          {busy ? <div className="fg-agent-working"><span /><span /><span />Agent 正在思考…</div> : null}
        </div>
        {showScrollToLatest ? <button type="button" className="fg-agent-scroll-latest" onClick={scrollToLatest}><ArrowDown size={13} /> 回到最新</button> : null}
      </div>
      {error ? <div className="fg-agent-error"><span>{error}</span><button type="button" className="fg-agent-retry" onClick={() => void loadSessions(sessionId)} disabled={loading}>重新读取</button><button type="button" className="fg-agent-dismiss" onClick={() => setError("")} aria-label="关闭错误提示"><X size={13} /></button></div> : null}
      <div className="fg-agent-composer">
        {images.length ? <div className="fg-agent-attachments">{images.map((image, index) => <div key={`${image.slice(0, 16)}-${index}`}><img src={image} alt={`参考图 ${index + 1}`} /><button type="button" onClick={() => setImages((current) => current.filter((_, item) => item !== index))}><X size={11} /></button></div>)}</div> : null}
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} placeholder="让 Agent 帮你写、想、分析或规划…" />
        <div className="fg-agent-composer-tools"><input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={attach} /><button type="button" onClick={() => fileRef.current?.click()} title="上传参考图"><Paperclip size={14} /></button><label className="fg-agent-model"><select value={model} onChange={(event) => setModel(event.target.value)}>{TEXT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className={thinking || reasoningEffort !== "auto" ? "active" : ""} onClick={() => setThinking((value) => !value)} title="推理模式"><Sparkles size={14} />推理</button><select className="fg-agent-reasoning" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)} aria-label="推理强度">{REASONING_EFFORT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><SkillPicker active={skill?.name || null} draftText={prompt} onApply={(name, content) => setSkill({ name, content })} onClear={() => setSkill(null)} /><button type="button" className="fg-agent-video-skill-trigger" onClick={() => { if (!skill) { setError("请先选择一个 Skill，再进入视频制作流程。"); return; } setSkillVideoOpen(true); }} title={skill ? "使用当前 Skill 制作视频" : "请先选择 Skill"}><Clapperboard size={14} />制作视频</button><PromptPicker onInsert={(text) => setPrompt((current) => current ? `${current}\n${text}` : text)} /><button type="button" className="fg-agent-send" onClick={() => void send()} disabled={busy || (!prompt.trim() && !images.length)} title="发送"><Send size={15} /></button></div>
      </div>
    </section>
  );
}
