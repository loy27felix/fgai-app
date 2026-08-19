"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/local/client";
import { WORKFLOW_SKILLS, PROMPT_GROUPS } from "@/lib/skillData";
import PageShell from "@/components/studio/PageShell";
import { Icon, Hov } from "@/components/studio/ui";

type Card = { title: string; sub?: string; body: string; img?: string; file?: string; mine?: boolean; id?: string };
const TABS = ["工作流 Skill", "Felix 提示词库", "画风", "运镜", "构图", "负向词", "我的"];

export default function PresetLibrary({ email }: { email?: string }) {
  const sb = createClient();
  const [tab, setTab] = useState(TABS[0]);
  const [q, setQ] = useState("");
  const [felix, setFelix] = useState<Card[]>([]);
  const [mine, setMine] = useState<Card[]>([]);
  const [view, setView] = useState<{ title: string; body: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nt, setNt] = useState(""); const [nb, setNb] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/felix-prompts.json").then((r) => r.json()).then((d) => setFelix((d.tabs || []).flatMap((t: any) => (t.items || []).map((it: any) => ({ title: it.title, sub: it.note || t.name, body: it.prompt, img: it.img }))))).catch(() => {});
    loadMine();
  }, []);
  async function loadMine() { const { data } = await sb.from("custom_presets").select("id,title,body").order("created_at", { ascending: false }); setMine((data || []).map((m: any) => ({ title: m.title, body: m.body, mine: true, id: m.id }))); }
  async function addMine() { if (!nt.trim() || !nb.trim()) return; await sb.from("custom_presets").insert({ title: nt.trim(), body: nb.trim() }); setNt(""); setNb(""); setAddOpen(false); loadMine(); }
  async function delMine(id: string) { if (!confirm("删除这条预设？")) return; await sb.from("custom_presets").delete().eq("id", id); loadMine(); }

  const cards: Card[] = useMemo(() => {
    if (tab === "工作流 Skill") return WORKFLOW_SKILLS.map((s) => ({ title: s.title, sub: s.desc, body: "", file: s.file }));
    if (tab === "Felix 提示词库") return felix;
    if (tab === "我的") return mine;
    const g = PROMPT_GROUPS.find((x) => x.name === tab);
    return (g?.items || []).map((it) => ({ title: it.title, body: it.prompt, sub: tab }));
  }, [tab, felix, mine]);
  const shown = cards.filter((c) => !q || (c.title + c.body + (c.sub || "")).toLowerCase().includes(q.toLowerCase()));

  function copy(c: Card) { navigator.clipboard?.writeText(c.body || ""); setCopied(c.title); setTimeout(() => setCopied(null), 1300); }
  async function openSkill(c: Card) { try { const r = await fetch("/skills/" + c.file); setView({ title: c.title, body: await r.text() }); } catch { alert("读取失败"); } }

  return (
    <PageShell title="预设库" email={email}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 30px 70px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}><span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>LIBRARY</span><span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>skills & prompts</span></div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>预设库 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>工作流技能 · 提示词 · 我的</span></h1>
          </div>
          {tab === "我的" && <Hov as="button" onClick={() => setAddOpen(true)} base={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 15px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)" }} hover={{ filter: "brightness(1.08)" }}><Icon d={["M12 5v14M5 12h14"]} size={15} sw={2} />新建预设</Hov>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{TABS.map((t) => { const on = tab === t; return <button key={t} onClick={() => setTab(t)} style={{ padding: "7px 13px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "var(--panel)", border: `1px solid ${on ? "var(--stroke-2)" : "var(--stroke)"}` }}>{t}</button>; })}</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 9, width: 260, maxWidth: "100%", height: 40, padding: "0 13px", borderRadius: 12, background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"]} size={17} sw={1.7} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }} /></div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
          {shown.length === 0 ? <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-3)", padding: "50px 0" }}>{tab === "我的" ? "还没有自定义预设,点右上「新建预设」。" : "无匹配项"}</div> :
            shown.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
                {c.img && <img src={c.img} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid var(--stroke-2)" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>{c.sub && <span className="fg-mono" style={{ fontSize: 9.5, color: "var(--text-3)", padding: "1px 6px", borderRadius: 6, background: "var(--bg-2)" }}>{c.sub}</span>}</div>
                {c.body && <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" } as any}>{c.body}</div>}
                <div style={{ display: "flex", gap: 7, marginTop: "auto" }}>
                  {c.file ? <button onClick={() => openSkill(c)} style={{ flex: 1, height: 32, borderRadius: 9, cursor: "pointer", fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>查看技能</button>
                    : <button onClick={() => copy(c)} style={{ flex: 1, height: 32, borderRadius: 9, cursor: "pointer", fontSize: 12, color: copied === c.title ? "var(--accent)" : "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>{copied === c.title ? "已复制 ✓" : "复制"}</button>}
                  {c.mine && c.id && <button onClick={() => delMine(c.id!)} style={{ width: 32, height: 32, borderRadius: 9, cursor: "pointer", color: "#ff9a8a", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"]} size={13} sw={1.6} /></button>}
                </div>
              </div>
            ))}
        </div>
      </div>

      {view && (
        <div onClick={() => setView(null)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: "100%", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 20, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ flex: "none", display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--stroke)" }}><b style={{ fontSize: 15 }}>{view.title}</b><div style={{ flex: 1 }} /><button onClick={() => { navigator.clipboard?.writeText(view.body); }} style={{ fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--stroke)", borderRadius: 8, padding: "5px 11px", cursor: "pointer", marginRight: 8 }}>复制全文</button><button onClick={() => setView(null)} style={{ width: 32, height: 32, borderRadius: 9, cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}>✕</button></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, fontSize: 13, lineHeight: 1.75, whiteSpace: "pre-wrap", color: "var(--text-2)" }}>{view.body}</div>
          </div>
        </div>
      )}
      {addOpen && (
        <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 20, padding: 22, boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>新建我的预设</div>
            <input value={nt} onChange={(e) => setNt(e.target.value)} placeholder="标题" style={{ width: "100%", height: 42, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 13px", color: "var(--text)", outline: "none", fontSize: 14, marginBottom: 10 }} />
            <textarea value={nb} onChange={(e) => setNb(e.target.value)} placeholder="提示词正文 / 技能内容" rows={6} style={{ width: "100%", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "11px 13px", color: "var(--text)", outline: "none", fontSize: 13.5, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button onClick={() => setAddOpen(false)} style={{ height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>取消</button><button onClick={addMine} disabled={!nt.trim() || !nb.trim()} style={{ height: 38, padding: "0 16px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: nt.trim() && nb.trim() ? 1 : 0.5 }}>保存</button></div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
