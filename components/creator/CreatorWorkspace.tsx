"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { TEXT_MODELS } from "@/lib/ai/catalog";
import type { CreatorMessage, CreatorSession } from "@/lib/creator/types";
import { Icon, Hov, useFgTheme } from "@/components/studio/ui";

const I = {
  chat: ["M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"],
  image: ["M4 4h16v16H4z", "m4 16 4-4 3 3 4-5 5 6", "M9 9h.01"],
  video: ["M3 5h14v14H3z", "m17 9 4-2v10l-4-2"],
  plus: ["M12 5v14M5 12h14"],
  send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
  clip: ["m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 1 1-2.8-2.8l8.9-8.9"],
  back: ["m15 18-6-6 6-6"],
  spark: ["M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z"],
};

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
  const [model, setModel] = useState(initialSessions.find((s) => s.id === initialSessionId)?.default_model || "gpt-5.6-luna");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedModel = TEXT_MODELS.find((item) => item.id === model) || TEXT_MODELS[2];
  const me = userEmail.replace(/@.*/, "").slice(0, 2).toUpperCase();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
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
    history.replaceState(null, "", `/creator?session=${data.session.id}`);
    return data.session.id as string;
  }

  async function newChat() {
    if (busy) return;
    setError("");
    try { await createSession(); } catch (e) { setError(e instanceof Error ? e.message : "创建会话失败"); }
  }

  async function openSession(id: string) {
    if (id === sessionId || busy) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/creator/sessions?sessionId=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取会话失败");
      setSessions(data.sessions);
      setMessages(data.messages);
      setSessionId(id);
      const active = data.sessions.find((s: CreatorSession) => s.id === id);
      if (active?.default_model) setModel(active.default_model);
      history.replaceState(null, "", `/creator?session=${id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "读取会话失败"); }
    finally { setLoading(false); }
  }

  async function send() {
    const text = prompt.trim();
    if ((!text && images.length === 0) || busy) return;
    if (images.length && !selectedModel.supportsImages) {
      setError("当前模型不支持图片，请选择 GPT-5.6 或 Claude Opus 4.8。");
      return;
    }
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
        body: JSON.stringify({ sessionId: activeId, message: text || "请分析这些参考图。", model, thinking, images }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "回复失败");
      setMessages((current) => [...current, data.message]);
      setSessions((current) => current.map((item) => item.id === activeId ? { ...item, title: data.title, default_model: data.model, updated_at: new Date().toISOString() } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "回复失败"); }
    finally { setBusy(false); }
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
    <button key={session.id} onClick={() => void openSession(session.id)} style={{ width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 10, border: `1px solid ${session.id === sessionId ? "var(--stroke-2)" : "transparent"}`, color: session.id === sessionId ? "var(--text)" : "var(--text-2)", background: session.id === sessionId ? "var(--panel-2)" : "transparent", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{session.title}</button>
  ));

  return (
    <div data-theme={theme} className="fg2" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(700px 520px at 100% 0%,var(--glow-coral),transparent 62%),radial-gradient(800px 600px at -10% 110%,var(--glow-b),transparent 60%)" }} />
      <header style={{ position: "relative", zIndex: 3, height: 60, flex: "none", display: "flex", alignItems: "center", gap: 13, padding: "0 18px", borderBottom: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(24px) saturate(1.4)" }}>
        <div className="fg-mono" style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontSize: 12, fontWeight: 700 }}>FG</div>
        <div><div style={{ fontWeight: 650, fontSize: 14 }}>AI 创作台</div><div className="fg-mono" style={{ fontSize: 9, color: "var(--text-3)", letterSpacing: 1.2 }}>PRIVATE CREATIVE SPACE</div></div>
        <div style={{ width: 1, height: 24, background: "var(--stroke)", marginLeft: 5 }} />
        <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>对话</span>
        <div style={{ flex: 1 }} />
        <a href="/projects" style={{ height: 36, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", fontSize: 12 }}><Icon d={I.back} size={15} />导演台</a>
        <Hov as="button" onClick={toggle} base={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }} hover={{ background: "var(--panel-2)", color: "var(--text)" }}><span style={{ fontSize: 15 }}>{theme === "dark" ? "☀" : "☾"}</span></Hov>
        <div className="fg-mono" style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", color: "var(--accent-ink)", fontSize: 11, fontWeight: 700 }}>{me}</div>
      </header>

      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex" }}>
        <aside className="fg-rail" style={{ width: 258, flex: "none", display: "flex", flexDirection: "column", padding: 12, borderRight: "1px solid var(--stroke)", background: "color-mix(in srgb,var(--panel) 86%,transparent)", backdropFilter: "blur(20px)" }}>
          <button onClick={() => void newChat()} style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, border: "1px solid var(--user-stroke)", background: "var(--user-bubble)", color: "var(--text)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}><Icon d={I.plus} size={16} sw={2} />新对话</button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5, marginTop: 10 }}>
            {[["对话", I.chat, true], ["独立生图", I.image, false], ["视频画布", I.video, false]].map(([label, path, active]) => <button key={label as string} disabled={!active} title={active ? "" : "下一模块接入"} style={{ minHeight: 58, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, border: `1px solid ${active ? "var(--stroke-2)" : "var(--stroke)"}`, background: active ? "var(--panel-2)" : "var(--panel)", color: active ? "var(--accent)" : "var(--text-3)", fontSize: 10.5, cursor: active ? "default" : "not-allowed", opacity: active ? 1 : .72 }}><Icon d={path as string[]} size={16} />{label as string}</button>)}
          </div>
          <div className="fg-mono" style={{ padding: "20px 9px 7px", fontSize: 9.5, letterSpacing: 1.5, color: "var(--text-3)" }}>今天</div>
          <div style={{ overflowY: "auto" }}>{sessionRows(grouped.today)}{grouped.earlier.length > 0 && <><div className="fg-mono" style={{ padding: "16px 9px 7px", fontSize: 9.5, letterSpacing: 1.5, color: "var(--text-3)" }}>更早</div>{sessionRows(grouped.earlier)}</>}</div>
          <div style={{ flex: 1 }} />
          <div style={{ padding: "10px 11px", borderRadius: 11, border: "1px solid var(--stroke)", background: "var(--panel)", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>媒体生成不会由聊天自动执行。生图和视频必须在草稿卡或画布节点中再次确认。</div>
        </aside>

        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "38px 24px 22px" }}>
            <div style={{ width: "min(760px,100%)", margin: "0 auto" }}>
              {loading ? <div style={{ textAlign: "center", color: "var(--text-3)", paddingTop: 80 }}>读取会话…</div> : messages.length === 0 ? (
                <div style={{ paddingTop: "min(16vh,130px)", textAlign: "center" }}>
                  <div style={{ width: 52, height: 52, margin: "0 auto", display: "grid", placeItems: "center", borderRadius: 16, background: "linear-gradient(145deg,var(--user-bubble),var(--panel-2))", border: "1px solid var(--user-stroke)", color: "var(--accent)", boxShadow: "0 18px 48px -25px var(--accent)" }}><Icon d={I.spark} size={23} /></div>
                  <h1 style={{ margin: "20px 0 8px", fontSize: 29, letterSpacing: "-.8px" }}>今天想创作什么？</h1>
                  <p style={{ margin: "0 auto", maxWidth: 530, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.8 }}>直接聊天、分析参考图，或调用你的 Skills 与 Prompt 模板。需要生图或生视频时，我会先整理成草稿，等你明确确认。</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 25, textAlign: "left" }}>
                    {["帮我把这个创意扩写成完整方案", "分析参考图的画面语言和可复用元素", "调用分镜 Skill，先给我一版镜头思路"].map((item) => <button key={item} onClick={() => setPrompt(item)} style={{ minHeight: 72, padding: "13px 15px", borderRadius: 14, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer", textAlign: "left", fontSize: 12.5, lineHeight: 1.55 }}>{item}</button>)}
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

          <div style={{ flex: "none", padding: "0 20px 18px" }}>
            <div style={{ width: "min(800px,100%)", margin: "0 auto" }}>
              {error && <div style={{ marginBottom: 8, color: "#ff9b85", fontSize: 12.5 }}>{error}</div>}
              {images.length > 0 && <div style={{ display: "flex", gap: 7, marginBottom: 8 }}>{images.map((src, index) => <div key={index} style={{ position: "relative" }}><img src={src} alt="参考图" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 10, border: "1px solid var(--stroke-2)" }} /><button onClick={() => setImages((current) => current.filter((_, i) => i !== index))} style={{ position: "absolute", right: -5, top: -5, width: 18, height: 18, borderRadius: "50%", border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>×</button></div>)}</div>}
              <div style={{ borderRadius: 18, border: "1px solid var(--stroke-2)", background: "var(--panel-2)", boxShadow: "var(--inset),0 26px 70px -42px rgba(0,0,0,.8)", overflow: "hidden" }}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={keyDown} placeholder="给 FG Studio 发消息…" rows={2} style={{ width: "100%", minHeight: 64, maxHeight: 180, resize: "none", padding: "14px 16px 8px", border: 0, outline: 0, background: "transparent", color: "var(--text)", font: "inherit", fontSize: 14, lineHeight: 1.6 }} />
                <div style={{ height: 46, display: "flex", alignItems: "center", gap: 7, padding: "0 9px 8px" }}>
                  <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={attach} />
                  <button onClick={() => fileRef.current?.click()} title="上传参考图（最多 4 张，每张 1.5MB）" style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text-2)", cursor: "pointer" }}><Icon d={I.clip} size={16} /></button>
                  <select value={model} onChange={(event) => { setModel(event.target.value); setError(""); }} style={{ height: 34, maxWidth: 220, padding: "0 28px 0 10px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text-2)", outline: 0, fontSize: 11.5 }}>{TEXT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                  {selectedModel.provider === "deepseek" && <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)", cursor: "pointer" }}><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} />深度思考</label>}
                  <div style={{ flex: 1 }} />
                  <span className="fg-mono" style={{ fontSize: 9.5, color: "var(--text-3)" }}>Enter 发送 · Shift+Enter 换行</span>
                  <button onClick={() => void send()} disabled={busy || (!prompt.trim() && images.length === 0)} style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 11, border: 0, background: "var(--accent)", color: "var(--accent-ink)", cursor: "pointer", opacity: busy || (!prompt.trim() && images.length === 0) ? .4 : 1 }}><Icon d={I.send} size={17} sw={1.9} /></button>
                </div>
              </div>
              <div style={{ marginTop: 7, textAlign: "center", fontSize: 10.5, color: "var(--text-3)" }}>AI 可能出错。媒体生成始终需要你的二次确认。</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
