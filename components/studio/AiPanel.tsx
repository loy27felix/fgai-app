"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { upsertSession } from "@/lib/chatStore";
import { TEXT_MODELS } from "@/lib/models";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { Icon, Hov } from "./ui";

export type AiMsg = { role: "user" | "ai"; text: string; images?: string[]; action?: string };

export default function AiPanel({
  projectId, scope, title, badge, contextNote, system, quick = [], placeholder, seed, onAction, embedded,
}: {
  projectId: string; scope: string; title: string; badge?: string; contextNote?: string;
  system: string; quick?: string[]; placeholder?: string; seed?: AiMsg[];
  onAction?: (action: string) => void; embedded?: boolean;
}) {
  const sb = createClient();
  const [messages, setMessages] = useState<AiMsg[]>(seed || []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("deepseek-flash");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<{ name: string; content: string } | null>(null);
  const [imgs, setImgs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages, busy]);

  async function pickFiles(files: FileList | null) {
    if (!files) return;
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith("image/")) continue;
      out.push(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); }));
    }
    setImgs((p) => [...p, ...out].slice(0, 4));
  }

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if ((!t && imgs.length === 0) || busy) return;
    const sendImgs = imgs;
    const next: AiMsg[] = [...messages, { role: "user", text: t, images: sendImgs.length ? sendImgs : undefined }];
    setMessages(next); setInput(""); setImgs([]); setBusy(true);
    try {
      const history = next.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
      const sys = system + (activeSkill ? `\n\n=== 已启用技能：${activeSkill.name} ===\n${activeSkill.content}` : "");
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, model, images: sendImgs, messages: [{ role: "system", content: sys }, ...history] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 请求失败");
      const all: AiMsg[] = [...next, { role: "ai", text: data.content || "" }];
      setMessages(all);
      try {
        const id = await upsertSession(sb, { id: sessionId, projectId, scope, title: sessionId ? "" : t.slice(0, 30) || "图片对话", messages: all });
        if (!sessionId && id) setSessionId(id);
      } catch {}
    } catch (e: any) {
      setMessages((m) => [...m, { role: "ai", text: "⚠️ " + (e?.message || "出错") }]);
    } finally { setBusy(false); }
  }

  const ipt = { display: "block", width: "100%", resize: "none" as const, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, lineHeight: 1.6, padding: "12px 13px 4px", fontFamily: "inherit" };
  const toolBtn = { height: 32, padding: "0 10px", borderRadius: 9, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: "var(--text-2)", background: "transparent", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" };

  const inner = (
    <>
      <div style={{ flex: "none", padding: "15px 18px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          {badge && <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "2px 7px", borderRadius: 6, border: "1px solid var(--stroke)" }}>{badge}</span>}
          <div style={{ flex: 1 }} />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="fg-mono"
            style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 8, padding: "4px 6px", cursor: "pointer", maxWidth: 120 }}>
            {TEXT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {contextNote && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--accent)", padding: "3px 9px", borderRadius: 7, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>
            <Icon d={["M5 13l4 4L19 7"]} size={12} sw={2} />{contextNote}
          </div>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.length === 0 && <div style={{ margin: "auto", textAlign: "center", color: "var(--text-3)", fontSize: 13, lineHeight: 1.7, maxWidth: 240 }}>开始和 AI 对话。<br />可上传参考图、启用技能或插入 Prompt。</div>}
        {messages.map((m, i) => m.role === "ai" ? (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: "none", width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}>
              <Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.7} />
            </div>
            <div style={{ minWidth: 0, maxWidth: "86%" }}>
              <div style={{ padding: "12px 14px", borderRadius: "4px 15px 15px 15px", background: "var(--panel-2)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{m.text}</div>
              {m.action && (
                <Hov as="button" onClick={() => onAction?.(m.action!)}
                  base={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--accent-ink)", background: "var(--accent)", border: "none", padding: "5px 11px", borderRadius: 8, cursor: "pointer", transition: "all .3s var(--ease)" }}
                  hover={{ filter: "brightness(1.08)" }}>
                  <Icon d={["M5 12h14M13 6l6 6-6 6"]} size={12} sw={2} />{m.action}
                </Hov>
              )}
            </div>
          </div>
        ) : (
          <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ maxWidth: "86%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              {m.images && m.images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                  {m.images.map((u, k) => <img key={k} src={u} alt="" style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 11, border: "1px solid var(--user-stroke)" }} />)}
                </div>
              )}
              {m.text && <div style={{ padding: "12px 14px", borderRadius: "15px 4px 15px 15px", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)", boxShadow: "var(--inset)", fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{m.text}</div>}
            </div>
          </div>
        ))}
        {busy && <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text-3)", fontSize: 12.5 }}><span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.7} /></span>AI 思考中…</div>}
      </div>

      <div style={{ flex: "none", padding: "12px 16px 16px", borderTop: "1px solid var(--stroke)" }}>
        {quick.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {quick.map((q) => (
              <Hov as="button" key={q} onClick={() => send(q)}
                base={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontSize: 11.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" }}
                hover={{ color: "var(--text)", background: "var(--panel-2)", borderColor: "var(--accent)" }}>{q}</Hov>
            ))}
          </div>
        )}
        {imgs.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {imgs.map((u, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={u} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 9, border: "1px solid var(--stroke-2)" }} />
                <button onClick={() => setImgs((p) => p.filter((_, k) => k !== i))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "pointer", background: "var(--panel-solid)", color: "var(--text)", fontSize: 11, lineHeight: "16px", boxShadow: "var(--shadow)" }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderRadius: 15, background: "var(--bg-2)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}
            placeholder={placeholder || "和 AI 对话……（⌘↵ 发送）"} rows={2} style={ipt as any} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 8px" }}>
            <SkillPicker active={activeSkill?.name || null} onApply={(name, content) => setActiveSkill({ name, content })} onClear={() => setActiveSkill(null)} />
            <PromptPicker onInsert={(t) => setInput((v) => (v ? v + "\n" + t : t))} />
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.currentTarget.value = ""; }} />
            <Hov as="button" title="上传参考图" onClick={() => fileRef.current?.click()} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel)" }}>
              <Icon d={["M21 15l-5-5L5 21", "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2Z", "M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"]} size={14} sw={1.7} />图
            </Hov>
            <div style={{ flex: 1 }} />
            <Hov as="button" onClick={() => send()} disabled={busy}
              base={{ display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 5px 0 13px", borderRadius: 12, cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", opacity: busy ? 0.6 : 1, transition: "all .3s var(--ease)" }}
              hover={busy ? undefined : { filter: "brightness(1.08)" }} active={busy ? undefined : { transform: "scale(.95)" }}>
              发送<span style={{ width: 24, height: 24, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M7 17 17 7M9 7h8v8"]} size={14} sw={2} /></span>
            </Hov>
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) return <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>{inner}</div>;
  return (
    <aside style={{ flex: "none", width: 392, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)" }}>{inner}</aside>
  );
}
