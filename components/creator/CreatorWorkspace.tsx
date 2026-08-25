"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TEXT_MODEL_ID, isTextModelId, TEXT_MODELS } from "@/lib/ai/catalog";
import { isConversationNearBottom } from "@/lib/creator/history";
import type { CreatorMessage, CreatorSession } from "@/lib/creator/types";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { Icon, Hov, useFgTheme } from "@/components/studio/ui";
import FGLogo from "@/components/FGLogo";

const I = {
  chat: ["M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"],
  image: ["M4 4h16v16H4z", "m4 16 4-4 3 3 4-5 5 6", "M9 9h.01"],
  video: ["M3 5h14v14H3z", "m17 9 4-2v10l-4-2"],
  plus: ["M12 5v14M5 12h14"],
  send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
  clip: ["m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 1 1-2.8-2.8l8.9-8.9"],
  back: ["m15 18-6-6 6-6"],
  spark: ["M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z"],
  more: ["M12 7.5h.01M12 12h.01M12 16.5h.01"],
  trash: ["M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"],
  down: ["m6 9 6 6 6-6"],
};

const STARTER_PROMPTS = [
  {
    index: "01",
    title: "把灵感变成方案",
    detail: "从一句概念开始，整理出角色、风格与可执行步骤。",
    prompt: "帮我把这个创意扩写成完整方案",
  },
  {
    index: "02",
    title: "读懂参考图",
    detail: "分析画面语言，提炼能复用到下一次创作的要素。",
    prompt: "分析参考图的画面语言和可复用元素",
  },
  {
    index: "03",
    title: "从分镜开始",
    detail: "调用分镜 Skill，先把镜头节奏和关键画面想清楚。",
    prompt: "调用分镜 Skill，先给我一版镜头思路",
  },
] as const;

type Props = {
  userEmail: string;
  initialSessions: CreatorSession[];
  initialMessages: CreatorMessage[];
  initialSessionId: string | null;
};

function textOf(message: CreatorMessage) {
  return typeof message.content?.text === "string" ? message.content.text : "";
}

export default function CreatorWorkspace({ userEmail, initialSessions, initialMessages, initialSessionId }: Props) {
  const { theme, toggle } = useFgTheme();
  const [sessions, setSessions] = useState(initialSessions);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState(initialMessages);
  const initialModel = initialSessions.find((s) => s.id === initialSessionId)?.default_model;
  const [model, setModel] = useState(isTextModelId(initialModel) ? initialModel : DEFAULT_TEXT_MODEL_ID);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [activeSkill, setActiveSkill] = useState<{ name: string; content: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CreatorSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const selectedModel = TEXT_MODELS.find((item) => item.id === model) || TEXT_MODELS[0];
  const me = userEmail.replace(/@.*/, "").slice(0, 2).toUpperCase();

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    const viewport = scrollRef.current;
    if (!viewport) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }

  function handleConversationScroll() {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const nearBottom = isConversationNearBottom(viewport);
    stickToBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest(messages.length ? "smooth" : "auto"));
    return () => cancelAnimationFrame(frame);
  }, [messages, busy]);

  const grouped = useMemo(() => ({
    today: sessions.filter((s) => Date.now() - new Date(s.updated_at).getTime() < 86400000),
    earlier: sessions.filter((s) => Date.now() - new Date(s.updated_at).getTime() >= 86400000),
  }), [sessions]);

  async function createSession() {
    const response = await fetch("/api/creator/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "chat", model }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建会话失败");
    setSessions((current) => [data.session, ...current]);
    setSessionId(data.session.id);
    setMessages([]);
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    history.replaceState(null, "", `/chat?session=${data.session.id}`);
    return data.session.id as string;
  }

  async function newChat() {
    if (busy) return;
    setError("");
    setMenuSessionId(null);
    setActiveSkill(null);
    setThinking(false);
    try { await createSession(); } catch (e) { setError(e instanceof Error ? e.message : "创建会话失败"); }
  }

  async function openSession(id: string) {
    if (id === sessionId || busy) return;
    setMenuSessionId(null);
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/creator/sessions?kind=chat&sessionId=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取会话失败");
      setSessions(data.sessions);
      setMessages(data.messages);
      setSessionId(id);
      setActiveSkill(null);
      setThinking(false);
      const active = data.sessions.find((s: CreatorSession) => s.id === id);
      if (isTextModelId(active?.default_model)) setModel(active.default_model);
      history.replaceState(null, "", `/chat?session=${id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "读取会话失败"); }
    finally { setLoading(false); }
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && images.length === 0) || busy) return;
    if (images.length && !selectedModel.supportsImages) {
      setError("当前模型不支持图片输入，请选择支持视觉输入的 Claude 或 GPT 模型。");
      return;
    }
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setBusy(true); setError("");
    try {
      const activeId = sessionId || await createSession();
      const optimistic: CreatorMessage = {
        id: `local-${Date.now()}`, session_id: activeId, role: "user",
        content: { text, images }, status: "complete", created_at: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      setPrompt(""); setImages([]);
      const response = await fetch("/api/creator/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeId, message: text || "请分析这些参考图。", model, thinking, images, skill: activeSkill }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "回复失败");
      setMessages((current) => [...current, data.message]);
      setSessions((current) => current.map((item) => item.id === activeId ? { ...item, title: data.title, default_model: data.model, updated_at: new Date().toISOString() } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "回复失败"); }
    finally { setBusy(false); }
  }

  async function confirmDeleteSession() {
    if (!deleteTarget || deleting || busy) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/creator/sessions?sessionId=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除会话失败");

      const remaining = sessions.filter((item) => item.id !== deleteTarget.id);
      const deletedActiveSession = deleteTarget.id === sessionId;
      setSessions(remaining);
      setMenuSessionId(null);
      setDeleteTarget(null);
      if (deletedActiveSession) {
        const next = remaining[0];
        if (next) {
          setSessionId(null);
          await openSession(next.id);
        } else {
          setSessionId(null);
          setMessages([]);
          setActiveSkill(null);
          setThinking(false);
          history.replaceState(null, "", "/chat");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除会话失败");
    } finally {
      setDeleting(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).slice(0, 4 - images.length);
    for (const file of files) {
      if (!file.type.startsWith("image/") || file.size > 1.5 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" && setImages((current) => [...current, reader.result as string].slice(0, 4));
      reader.readAsDataURL(file);
    }
    event.target.value = "";
  }

  const sessionRows = (items: CreatorSession[]) => items.map((session) => (
    <div key={session.id} style={{ position: "relative", display: "flex", alignItems: "center", borderRadius: 10, border: `1px solid ${session.id === sessionId ? "var(--stroke-2)" : "transparent"}`, background: session.id === sessionId ? "var(--panel-2)" : "transparent" }}>
      <button onClick={() => void openSession(session.id)} title={session.title} style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "9px 5px 9px 11px", border: 0, color: session.id === sessionId ? "var(--text)" : "var(--text-2)", background: "transparent", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{session.title}</button>
      <button aria-label={`更多：${session.title}`} title="更多" onClick={() => setMenuSessionId((current) => current === session.id ? null : session.id)} style={{ width: 30, height: 30, flex: "none", display: "grid", placeItems: "center", marginRight: 3, border: 0, borderRadius: 8, background: menuSessionId === session.id ? "var(--panel-solid)" : "transparent", color: "var(--text-3)", cursor: "pointer" }}><Icon d={I.more} size={17} sw={2.2} /></button>
      {menuSessionId === session.id && (
        <div role="menu" style={{ position: "absolute", zIndex: 20, top: 34, right: 3, width: 142, padding: 5, borderRadius: 11, border: "1px solid var(--stroke-2)", background: "var(--panel-solid)", boxShadow: "0 18px 45px rgba(0,0,0,.28)" }}>
          <button role="menuitem" onClick={() => { setMenuSessionId(null); setDeleteTarget(session); }} style={{ width: "100%", height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", border: 0, borderRadius: 8, background: "transparent", color: "#ff8d7c", cursor: "pointer", fontSize: 12.5 }}><Icon d={I.trash} size={15} />删除</button>
        </div>
      )}
    </div>
  ));

  return (
    <div data-theme={theme} className="fg2 creator-chat" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", color: "var(--text)" }}>
      <div className="creator-chat-atmosphere" style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(700px 520px at 100% 0%,var(--glow-coral),transparent 62%),radial-gradient(800px 600px at -10% 110%,var(--glow-b),transparent 60%)" }} />
      <header className="creator-chat-header" style={{ position: "relative", zIndex: 3, height: 60, flex: "none", display: "flex", alignItems: "center", gap: 13, padding: "0 18px", borderBottom: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(24px) saturate(1.4)" }}>
        <a href="/workspace" title="返回工作区"><FGLogo size={36} /></a>
        <div className="creator-chat-title"><div style={{ fontWeight: 650, fontSize: 14 }}>AI 对话</div><div className="fg-mono" style={{ fontSize: 9, color: "var(--text-3)", letterSpacing: 1.2 }}>MULTI-MODEL CONVERSATION</div></div>
        <div className="creator-chat-header-divider" style={{ width: 1, height: 24, background: "var(--stroke)", marginLeft: 5 }} />
        <span className="creator-chat-context" style={{ fontSize: 12.5, color: "var(--text-2)" }}>会话工作台</span>
        <div style={{ flex: 1 }} />
        <a className="creator-chat-workspace-link" href="/workspace" style={{ height: 36, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", fontSize: 12 }}><Icon d={I.back} size={15} />工作区</a>
        <Hov as="button" onClick={toggle} base={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }} hover={{ background: "var(--panel-2)", color: "var(--text)" }}><span style={{ fontSize: 15 }}>{theme === "dark" ? "☀" : "☾"}</span></Hov>
        <div className="fg-mono creator-chat-avatar" style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontSize: 11, fontWeight: 700 }}>{me}</div>
      </header>

      <div className="creator-chat-layout" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex" }}>
        <aside className="fg-rail creator-chat-rail" style={{ width: 258, flex: "none", display: "flex", flexDirection: "column", padding: 12, borderRight: "1px solid var(--stroke)", background: "color-mix(in srgb,var(--panel) 86%,transparent)", backdropFilter: "blur(20px)" }}>
          <button className="creator-chat-new" onClick={() => void newChat()} style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, border: "1px solid var(--user-stroke)", background: "var(--user-bubble)", color: "var(--text)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Icon d={I.plus} size={16} sw={2} />新对话</button>
          <div className="creator-chat-switcher" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 5, marginTop: 10 }}>
            <button type="button" style={{ minHeight: 58, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, border: "1px solid var(--stroke-2)", background: "var(--panel-2)", color: "var(--accent)", fontSize: 10.5, cursor: "default" }}><Icon d={I.chat} size={16} />AI 对话</button>
            <a href="/creator" style={{ minHeight: 58, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, border: "1px solid #34d39966", background: "#064e3b22", color: "#34d399", fontSize: 10.5, textDecoration: "none" }}><Icon d={I.image} size={16} />超级画布</a>
            <a href="/creator/image" style={{ minHeight: 58, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", fontSize: 10.5, textDecoration: "none" }}><Icon d={I.image} size={16} />独立生图</a>
            <a href="/creator/video" style={{ minHeight: 58, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", fontSize: 10.5, textDecoration: "none" }}><Icon d={I.video} size={16} />视频画布</a>
          </div>
          <div className="fg-mono" style={{ padding: "20px 9px 7px", fontSize: 9.5, letterSpacing: 1.5, color: "var(--text-3)" }}>今天</div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarGutter: "stable" }}>{sessionRows(grouped.today)}{grouped.earlier.length > 0 && <><div className="fg-mono" style={{ padding: "16px 9px 7px", fontSize: 9.5, letterSpacing: 1.5, color: "var(--text-3)" }}>更早</div>{sessionRows(grouped.earlier)}</>}</div>
          <div style={{ padding: "10px 11px", borderRadius: 11, border: "1px solid var(--stroke)", background: "var(--panel)", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>媒体生成不会由聊天自动执行。生图和视频必须在草稿卡或画布节点中再次确认。</div>
        </aside>

        <main className="creator-chat-main" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div ref={scrollRef} className="creator-chat-scroll" role="log" aria-live="polite" aria-label="对话消息" onScroll={handleConversationScroll} style={{ height: "100%", minHeight: 0, overflowY: "auto", overscrollBehaviorY: "contain", scrollbarGutter: "stable", padding: "38px 24px 22px" }}>
            <div className="creator-chat-conversation" style={{ width: "min(760px,100%)", margin: "0 auto" }}>
              {loading ? <div style={{ textAlign: "center", color: "var(--text-3)", paddingTop: 80 }}>读取会话…</div> : messages.length === 0 ? (
                <div className="creator-chat-empty" style={{ paddingTop: "min(16vh,130px)", textAlign: "center" }}>
                  <div className="creator-chat-empty-mark" style={{ width: 52, height: 52, margin: "0 auto", display: "grid", placeItems: "center", borderRadius: 16, background: "linear-gradient(145deg,var(--user-bubble),var(--panel-2))", border: "1px solid var(--user-stroke)", color: "var(--accent)", boxShadow: "0 18px 48px -25px var(--accent)" }}><Icon d={I.spark} size={23} /></div>
                  <p className="creator-chat-eyebrow">今天想创作什么？ · FG / CREATIVE COPILOT</p>
                  <h1 style={{ margin: "20px 0 8px", fontSize: 29, letterSpacing: "-.8px" }}>从一个想法，开始一条创作线。</h1>
                  <p className="creator-chat-empty-copy" style={{ margin: "0 auto", maxWidth: 530, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.8 }}>在同一个会话里切换模型、调用团队 Skills、整理 Prompt 与参考图。需要生成媒体时，先把方案写清楚，再交给超级画布。</p>
                  <div className="creator-chat-starter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 25, textAlign: "left" }}>
                    {STARTER_PROMPTS.map((item) => <button className="creator-chat-starter" key={item.index} onClick={() => setPrompt(item.prompt)} style={{ minHeight: 72, padding: "13px 15px", borderRadius: 14, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer", textAlign: "left", fontSize: 12.5, lineHeight: 1.55 }}><span className="fg-mono">{item.index}</span><strong>{item.title}</strong><small>{item.detail}</small><i aria-hidden="true">↗</i></button>)}
                  </div>
                </div>
              ) : messages.map((message) => message.role === "user" ? (
                <div key={message.id} style={{ display: "flex", justifyContent: "flex-end", margin: "22px 0" }}><div style={{ maxWidth: "78%", padding: "11px 15px", borderRadius: "17px 17px 4px 17px", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)", lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap" }}>{textOf(message)}{(message.content.image_count || message.content.images?.length || 0) > 0 ? <div style={{ marginTop: 7, fontSize: 10.5, color: "var(--text-3)" }}>附 {message.content.image_count || message.content.images?.length} 张参考图</div> : null}</div></div>
              ) : (
                <div key={message.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 12, margin: "26px 0" }}><div className="fg-mono" style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 9, background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontSize: 9, fontWeight: 700 }}>FG</div><div style={{ paddingTop: 2, lineHeight: 1.85, fontSize: 14.5, whiteSpace: "pre-wrap", color: message.status === "failed" ? "#ff9b85" : "var(--text)" }}>{textOf(message)}</div></div>
              ))}
              {busy && <div style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 12, margin: "26px 0" }}><div className="fg-mono" style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 9, background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontSize: 9, fontWeight: 700 }}>FG</div><div style={{ color: "var(--text-3)", paddingTop: 4 }}>正在思考<span style={{ letterSpacing: 3 }}>…</span></div></div>}
            </div>
          </div>
          {showJumpToLatest && <button onClick={() => scrollToLatest()} aria-label="回到最新消息" style={{ position: "absolute", zIndex: 5, left: "50%", bottom: 12, transform: "translateX(-50%)", height: 34, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRadius: 999, border: "1px solid var(--stroke-2)", background: "var(--panel-solid)", color: "var(--text-2)", boxShadow: "0 12px 34px rgba(0,0,0,.22)", cursor: "pointer", fontSize: 11.5 }}><Icon d={I.down} size={14} />回到最新</button>}
          </div>

          <div className="creator-chat-composer-wrap" style={{ flex: "none", padding: "0 20px 18px" }}>
            <div style={{ width: "min(800px,100%)", margin: "0 auto" }}>
              {error && <div style={{ marginBottom: 8, color: "#ff9b85", fontSize: 12.5 }}>{error}</div>}
              {images.length > 0 && <div className="creator-chat-attachments" style={{ display: "flex", gap: 7, marginBottom: 8 }}>{images.map((src, index) => <div key={index} style={{ position: "relative" }}><img src={src} alt="参考图" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 10, border: "1px solid var(--stroke-2)" }} /><button aria-label={`移除第 ${index + 1} 张参考图`} onClick={() => setImages((current) => current.filter((_, i) => i !== index))} style={{ position: "absolute", right: -5, top: -5, width: 18, height: 18, borderRadius: "50%", border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>×</button></div>)}</div>}
              <div className="creator-chat-composer" style={{ borderRadius: 18, border: "1px solid var(--stroke-2)", background: "var(--panel-2)", boxShadow: "var(--inset),0 26px 70px -42px rgba(0,0,0,.8)", overflow: "hidden" }}>
                <textarea className="creator-chat-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={keyDown} placeholder="给 FG Studio 发消息…" rows={2} style={{ width: "100%", minHeight: 64, maxHeight: 180, resize: "none", padding: "14px 16px 8px", border: 0, outline: 0, background: "transparent", color: "var(--text)", font: "inherit", fontSize: 14, lineHeight: 1.6 }} />
                <div className="creator-chat-tools" style={{ minHeight: 46, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, padding: "0 9px 8px" }}>
                  <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={attach} />
                  <button className="creator-chat-attach" aria-label="上传参考图" onClick={() => fileRef.current?.click()} title="上传参考图（最多 4 张，每张 1.5MB）" style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }}><Icon d={I.clip} size={16} /></button>
                  <select className="creator-chat-model" aria-label="选择模型" value={model} onChange={(event) => { setModel(event.target.value); setError(""); }} style={{ height: 34, maxWidth: 200, padding: "0 28px 0 10px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text-2)", outline: 0, fontSize: 11.5 }}>{TEXT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                  <SkillPicker active={activeSkill?.name || null} onApply={(name, content) => setActiveSkill({ name, content })} onClear={() => setActiveSkill(null)} />
                  <PromptPicker onInsert={(text) => setPrompt((current) => current.trim() ? `${current.trimEnd()}\n${text}` : text)} />
                  <label className="creator-chat-thinking" title="开启后会要求模型先分析、核对，再给出简洁答案" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: thinking ? "var(--accent)" : "var(--text-3)", cursor: "pointer", userSelect: "none" }}>
                    <input aria-label="推理模式" type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} hidden />
                    <span style={{ width: 28, height: 16, padding: 2, display: "flex", justifyContent: thinking ? "flex-end" : "flex-start", borderRadius: 999, background: thinking ? "var(--accent)" : "var(--stroke-2)", transition: "background .18s ease" }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: thinking ? "var(--accent-ink)" : "var(--text-3)" }} /></span>
                    推理
                  </label>
                  <div style={{ flex: 1 }} />
                  <button className="creator-chat-send" aria-label="发送消息" onClick={() => void send()} disabled={busy || (!prompt.trim() && images.length === 0)} style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 11, border: 0, background: "var(--accent)", color: "var(--accent-ink)", cursor: "pointer", opacity: busy || (!prompt.trim() && images.length === 0) ? .4 : 1 }}><Icon d={I.send} size={17} sw={1.9} /></button>
                </div>
              </div>
              <div className="creator-chat-disclaimer" style={{ marginTop: 7, textAlign: "center", fontSize: 10.5, color: "var(--text-3)" }}>AI 可能出错。媒体生成始终需要你的二次确认。</div>
            </div>
          </div>
        </main>
      </div>
      {deleteTarget && (
        <div onMouseDown={() => !deleting && setDeleteTarget(null)} style={{ position: "fixed", zIndex: 50, inset: 0, display: "grid", placeItems: "center", padding: 20, background: "rgba(5,7,9,.62)", backdropFilter: "blur(8px)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-session-title" onMouseDown={(event) => event.stopPropagation()} style={{ width: "min(420px,100%)", padding: 22, borderRadius: 18, border: "1px solid var(--stroke-2)", background: "var(--panel-solid)", boxShadow: "0 28px 90px rgba(0,0,0,.48)" }}>
            <div style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 12, background: "rgba(255,111,91,.12)", color: "#ff8d7c" }}><Icon d={I.trash} size={18} /></div>
            <h2 id="delete-session-title" style={{ margin: "16px 0 7px", fontSize: 18 }}>删除对话？</h2>
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13, lineHeight: 1.7 }}>“{deleteTarget.title}”及其中的全部消息将被永久删除。</p>
            <p style={{ margin: "7px 0 0", color: "#ff9b85", fontSize: 12 }}>此操作无法撤销。</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 22 }}><button disabled={deleting} onClick={() => setDeleteTarget(null)} style={{ height: 38, padding: "0 15px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }}>取消</button><button disabled={deleting} onClick={() => void confirmDeleteSession()} style={{ height: 38, padding: "0 15px", borderRadius: 10, border: 0, background: "#e65f4c", color: "white", cursor: deleting ? "wait" : "pointer", fontWeight: 650 }}>{deleting ? "删除中…" : "删除对话"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

