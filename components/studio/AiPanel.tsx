"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { upsertSession, listSessions, loadSession, deleteSession, type ChatSession } from "@/lib/chatStore";
import { TEXT_MODELS } from "@/lib/models";
import { WORKFLOW_SKILLS, PROMPT_GROUPS } from "@/lib/skillData";
import CommandPalette, { PaletteItem } from "./CommandPalette";
import { Icon, Hov } from "./ui";

export type AiMsg = { role: "user" | "ai"; text: string; images?: string[]; action?: string };

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("加载失败")); document.head.appendChild(s);
  });
}
async function extractDoc(file: File): Promise<string> {
  const n = file.name.toLowerCase();
  if (/\.(txt|md|markdown|csv|fountain|json|srt|text)$/.test(n) || file.type.startsWith("text/")) return await file.text();
  if (n.endsWith(".docx")) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"); const ab = await file.arrayBuffer(); const r = await (window as any).mammoth.extractRawText({ arrayBuffer: ab }); return r.value || ""; }
  if (n.endsWith(".pdf")) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    const pdfjs = (window as any).pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const ab = await file.arrayBuffer(); const doc = await pdfjs.getDocument({ data: ab }).promise; let out = "";
    for (let p = 1; p <= Math.min(doc.numPages, 40); p++) { const pg = await doc.getPage(p); const tc = await pg.getTextContent(); out += tc.items.map((i: any) => i.str).join(" ") + "\n"; }
    return out;
  }
  throw new Error("仅支持 txt/md/csv/pdf/docx");
}

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
  const [activeSkills, setActiveSkills] = useState<{ name: string; content: string }[]>([]);
  const [imgs, setImgs] = useState<string[]>([]);
  const [docs, setDocs] = useState<{ name: string; text: string }[]>([]);
  const [docBusy, setDocBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const [skillOpen, setSkillOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [mine, setMine] = useState<{ title: string; body: string }[]>([]);
  const [felix, setFelix] = useState<PaletteItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  async function ensureData() {
    if (loaded) return; setLoaded(true);
    try { const { data } = await sb.from("custom_presets").select("title,body").order("created_at", { ascending: false }); setMine((data as any) || []); } catch {}
    try { const r = await fetch("/felix-prompts.json"); const d = await r.json(); setFelix((d.tabs || []).flatMap((t: any) => (t.items || []).map((it: any) => ({ title: it.title, sub: it.note, body: it.prompt, group: "Felix·" + t.name, img: it.img })))); } catch {}
  }
  const skillItems: PaletteItem[] = useMemo(() => [
    ...WORKFLOW_SKILLS.map((s) => ({ title: s.title, sub: s.desc, body: "@file:" + s.file, group: "工作流技能" })),
    ...mine.map((m) => ({ title: m.title, sub: "我的技能", body: m.body, group: "我的技能" })),
  ], [mine]);
  const promptItems: PaletteItem[] = useMemo(() => [
    ...PROMPT_GROUPS.flatMap((g) => g.items.map((it) => ({ title: it.title, body: it.prompt, group: g.name }))),
    ...felix,
    ...mine.map((m) => ({ title: m.title, body: m.body, group: "我的预设" })),
  ], [felix, mine]);
  async function pickSkill(it: PaletteItem) {
    if (activeSkills.some((s) => s.name === it.title)) { setActiveSkills((a) => a.filter((s) => s.name !== it.title)); return; }
    let content = it.body;
    if (it.body.startsWith("@file:")) { try { const r = await fetch("/skills/" + it.body.slice(6)); content = await r.text(); } catch { alert("技能读取失败"); return; } }
    setActiveSkills((a) => [...a, { name: it.title, content }]);
  }

  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages, busy]);

  async function pickFiles(files: FileList | null) {
    if (!files) return;
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, 4)) { if (!f.type.startsWith("image/")) continue; out.push(await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); })); }
    setImgs((p) => [...p, ...out].slice(0, 4));
  }
  async function pickDocs(files: FileList | null) {
    if (!files || !files.length) return; setDocBusy(true);
    try { for (const f of Array.from(files).slice(0, 3)) { try { const text = await extractDoc(f); setDocs((p) => [...p, { name: f.name, text }].slice(0, 3)); } catch (e: any) { alert(`「${f.name}」解析失败：${e?.message || ""}`); } } }
    finally { setDocBusy(false); }
  }

  async function openHistory() { setHistOpen(true); try { setSessions(await listSessions(sb, projectId, scope)); } catch {} }
  async function loadSess(id: string) { try { const m = await loadSession(sb, id); setMessages((m as AiMsg[]) || []); setSessionId(id); setHistOpen(false); } catch {} }
  async function delSess(id: string) { try { await deleteSession(sb, id); setSessions((s) => s.filter((x) => x.id !== id)); if (id === sessionId) { setSessionId(null); setMessages([]); } } catch {} }
  function newChat() { setMessages([]); setSessionId(null); setInput(""); setImgs([]); setDocs([]); setHistOpen(false); }

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if ((!t && imgs.length === 0 && docs.length === 0) || busy) return;
    const sendImgs = imgs, sendDocs = docs;
    const shownText = t + (sendDocs.length ? "\n\n" + sendDocs.map((d) => "📎 " + d.name).join("   ") : "");
    const next: AiMsg[] = [...messages, { role: "user", text: shownText, images: sendImgs.length ? sendImgs : undefined }];
    setMessages(next); setInput(""); setImgs([]); setDocs([]); setBusy(true);
    try {
      const docBlock = sendDocs.length ? "\n\n" + sendDocs.map((d) => `【附件文件：${d.name}】\n${d.text.slice(0, 8000)}`).join("\n\n") : "";
      const history = next.map((m, i) => ({ role: m.role === "ai" ? "assistant" : "user", content: i === next.length - 1 ? t + docBlock : m.text }));
      const skillBlock = activeSkills.map((s) => `=== 已启用技能：${s.name} ===\n${s.content}`).join("\n\n");
      const sys = system + (skillBlock ? "\n\n" + skillBlock : "");
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, model, images: sendImgs, messages: [{ role: "system", content: sys }, ...history] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 请求失败");
      const all: AiMsg[] = [...next, { role: "ai", text: data.content || "" }];
      setMessages(all);
      try { const id = await upsertSession(sb, { id: sessionId, projectId, scope, title: sessionId ? "" : (t.slice(0, 30) || "新对话"), messages: all }); if (!sessionId && id) setSessionId(id); } catch {}
    } catch (e: any) { setMessages((m) => [...m, { role: "ai", text: "⚠️ " + (e?.message || "出错") }]); }
    finally { setBusy(false); }
  }

  const ipt = { display: "block", width: "100%", resize: "none" as const, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, lineHeight: 1.6, padding: "12px 13px 4px", fontFamily: "inherit" };
  const toolBtn = { height: 32, padding: "0 10px", borderRadius: 9, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: "var(--text-2)", background: "transparent", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" };
  const iconBtn = { width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" };

  const inner = (
    <>
      <div style={{ flex: "none", padding: "13px 16px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)" }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          {badge && <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "2px 7px", borderRadius: 6, border: "1px solid var(--stroke)" }}>{badge}</span>}
          <div style={{ flex: 1 }} />
          <Hov as="button" title="新对话" onClick={newChat} base={iconBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["M12 5v14M5 12h14"]} size={16} sw={1.8} /></Hov>
          <Hov as="button" title="对话历史" onClick={openHistory} base={iconBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["M12 8v4l3 2", "M3.05 11a9 9 0 1 1 .5 4M3 4v5h5"]} size={16} sw={1.7} /></Hov>
          <Hov as="button" title={expanded ? "退出全屏" : "全屏专注"} onClick={() => setExpanded((v) => !v)} base={iconBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}>{expanded ? <Icon d={["M9 9H4M9 9V4M15 9h5M15 9V4M9 15H4M9 15v5M15 15h5M15 15v5"]} size={16} sw={1.7} /> : <Icon d={["M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"]} size={16} sw={1.7} />}</Hov>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="fg-mono" style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 8, padding: "6px 6px", cursor: "pointer", maxWidth: 130 }}>
            {TEXT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {contextNote && <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--accent)", padding: "3px 9px", borderRadius: 7, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}><Icon d={["M5 13l4 4L19 7"]} size={12} sw={2} />{contextNote}</div>}
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} style={{ position: "absolute", inset: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.length === 0 && <div style={{ margin: "auto", textAlign: "center", color: "var(--text-3)", fontSize: 13, lineHeight: 1.7, maxWidth: 250 }}>开始和 AI 对话。<br />可上传参考图、文档(pdf/word/md),启用技能或插入 Prompt。</div>}
          {messages.map((m, i) => m.role === "ai" ? (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: "none", width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.7} /></div>
              <div style={{ minWidth: 0, maxWidth: expanded ? "76%" : "86%" }}>
                <div style={{ padding: "12px 14px", borderRadius: "4px 15px 15px 15px", background: "var(--panel-2)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", fontSize: 13.5, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{m.text}</div>
                {m.action && <Hov as="button" onClick={() => onAction?.(m.action!)} base={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--accent-ink)", background: "var(--accent)", border: "none", padding: "5px 11px", borderRadius: 8, cursor: "pointer" }} hover={{ filter: "brightness(1.08)" }}><Icon d={["M5 12h14M13 6l6 6-6 6"]} size={12} sw={2} />{m.action}</Hov>}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ maxWidth: expanded ? "76%" : "86%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                {m.images && m.images.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>{m.images.map((u, k) => <img key={k} src={u} alt="" style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 11, border: "1px solid var(--user-stroke)" }} />)}</div>}
                {m.text && <div style={{ padding: "12px 14px", borderRadius: "15px 4px 15px 15px", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)", boxShadow: "var(--inset)", fontSize: 13.5, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{m.text}</div>}
              </div>
            </div>
          ))}
          {busy && <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text-3)", fontSize: 12.5 }}><span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.7} /></span>AI 思考中…</div>}
        </div>

        {histOpen && (
          <div style={{ position: "absolute", inset: 0, zIndex: 6, background: "var(--panel-solid)", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: "1px solid var(--stroke)" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>对话历史</span><span className="fg-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{sessions.length}</span>
              <div style={{ flex: 1 }} />
              <button onClick={newChat} style={{ ...toolBtn, color: "var(--accent)" }}><Icon d={["M12 5v14M5 12h14"]} size={13} sw={1.9} />新对话</button>
              <button onClick={() => setHistOpen(false)} style={iconBtn as any}><Icon d={["M6 6l12 12M18 6 6 18"]} size={15} sw={1.8} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
              {sessions.length === 0 ? <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 13, padding: "40px 0" }}>还没有历史对话</div> : sessions.map((s) => (
                <div key={s.id} onClick={() => loadSess(s.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12, cursor: "pointer", background: s.id === sessionId ? "var(--user-bubble)" : "transparent", border: `1px solid ${s.id === sessionId ? "var(--user-stroke)" : "transparent"}`, marginBottom: 4 }}>
                  <span style={{ color: "var(--text-3)" }}><Icon d={["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]} size={15} sw={1.6} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || "未命名对话"}</div><div className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{new Date(s.updated_at).toLocaleString("zh-CN")}</div></div>
                  <button onClick={(e) => { e.stopPropagation(); delSess(s.id); }} style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"]} size={13} sw={1.6} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: "none", padding: "12px 16px 16px", borderTop: "1px solid var(--stroke)" }}>
        {quick.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>{quick.map((qq) => <Hov as="button" key={qq} onClick={() => send(qq)} base={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontSize: 11.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }} hover={{ color: "var(--text)", background: "var(--panel-2)", borderColor: "var(--accent)" }}>{qq}</Hov>)}</div>}
        {(imgs.length > 0 || docs.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {imgs.map((u, i) => <div key={"i" + i} style={{ position: "relative" }}><img src={u} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 9, border: "1px solid var(--stroke-2)" }} /><button onClick={() => setImgs((p) => p.filter((_, k) => k !== i))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "pointer", background: "var(--panel-solid)", color: "var(--text)", fontSize: 11 }}>✕</button></div>)}
            {docs.map((d, i) => <div key={"d" + i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", borderRadius: 9, background: "var(--panel-2)", border: "1px solid var(--stroke-2)" }}><Icon d={["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"]} size={14} sw={1.6} /><span className="fg-mono" style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span><button onClick={() => setDocs((p) => p.filter((_, k) => k !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)" }}>✕</button></div>)}
          </div>
        )}
        <div style={{ borderRadius: 15, background: "var(--bg-2)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }} placeholder={placeholder || "和 AI 对话……（⌘↵ 发送）"} rows={expanded ? 4 : 2} style={ipt as any} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "6px 8px 8px" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Hov as="button" onClick={() => { ensureData(); setSkillOpen(true); }} base={{ ...toolBtn, color: activeSkills.length ? "var(--accent)" : "var(--text-2)", borderColor: activeSkills.length ? "var(--accent)" : "var(--stroke)", maxWidth: 150 }} hover={{ background: "var(--panel)" }}><Icon d={["M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6V21h3l6-6a4 4 0 0 0 5.6-5.6l-2.3 2.3-2.6-2.6 2.3-2.3z"]} size={14} sw={1.6} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeSkills.length ? `技能 · ${activeSkills.length}` : "Skill"}</span>{activeSkills.length > 0 && <span onClick={(e) => { e.stopPropagation(); setActiveSkills([]); }} style={{ marginLeft: 2, opacity: 0.7 }}>✕</span>}</Hov>
              <Hov as="button" onClick={() => { ensureData(); setPromptOpen(true); }} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel)" }}><Icon d={["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"]} size={14} sw={1.7} />Prompt</Hov>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.currentTarget.value = ""; }} />
              <Hov as="button" title="参考图" onClick={() => fileRef.current?.click()} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel)" }}><Icon d={["M21 15l-5-5L5 21", "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2Z", "M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"]} size={14} sw={1.7} />图</Hov>
              <input ref={docRef} type="file" accept=".txt,.md,.markdown,.csv,.fountain,.json,.srt,.pdf,.docx" multiple hidden onChange={(e) => { pickDocs(e.target.files); e.currentTarget.value = ""; }} />
              <Hov as="button" title="上传文档 pdf/word/md/txt" onClick={() => docRef.current?.click()} base={toolBtn} hover={{ color: "var(--text)", background: "var(--panel)" }}><Icon d={["m21 15-3.1-3.1a2 2 0 0 0-2.8 0L8 19", "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"]} size={14} sw={1.6} />{docBusy ? "解析中…" : "文档"}</Hov>
            </div>
            <Hov as="button" onClick={() => send()} disabled={busy} base={{ flex: "none", display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 5px 0 13px", borderRadius: 12, cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", opacity: busy ? 0.6 : 1 }} hover={busy ? undefined : { filter: "brightness(1.08)" }} active={busy ? undefined : { transform: "scale(.95)" }}>发送<span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M7 17 17 7M9 7h8v8"]} size={14} sw={2} /></span></Hov>
          </div>
        </div>
      </div>

      <CommandPalette open={skillOpen} onClose={() => setSkillOpen(false)} title="启用工作流技能" hint="可多选 · 点选叠加 / 再点取消" accentGroup="工作流技能" searchPlaceholder="搜索技能…" items={skillItems} onPick={pickSkill} multi isSelected={(it) => activeSkills.some((s) => s.name === it.title)}
        extraTop={activeSkills.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>{activeSkills.map((s) => <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--accent)", padding: "4px 9px", borderRadius: 8, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>{s.name}<span onClick={() => setActiveSkills((a) => a.filter((x) => x.name !== s.name))} style={{ cursor: "pointer", opacity: 0.7 }}>✕</span></span>)}<button onClick={() => setActiveSkills([])} style={{ fontSize: 11.5, color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)", borderRadius: 8, padding: "4px 9px", cursor: "pointer" }}>全部停用</button></div> : undefined} />
      <CommandPalette open={promptOpen} onClose={() => setPromptOpen(false)} title="插入 Prompt 片段" hint="点选把提示词插入输入框 · 带参考图" searchPlaceholder="搜索提示词…" items={promptItems} onPick={(it) => setInput((v) => (v ? v + "\n" + it.body : it.body))} />
    </>
  );

  if (expanded) {
    const theme = typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
    return createPortal(
      <div data-theme={theme} className="fg2" onClick={() => setExpanded(false)} style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(2,6,16,.55)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1080px,96vw)", height: "92vh", display: "flex", flexDirection: "column", background: "var(--panel-solid)", color: "var(--text)", border: "1px solid var(--stroke-2)", borderRadius: 22, boxShadow: "var(--shadow)", overflow: "hidden" }}>{inner}</div>
      </div>, document.body);
  }
  if (embedded) return <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>{inner}</div>;
  return <aside style={{ flex: "none", width: 392, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)" }}>{inner}</aside>;
}
