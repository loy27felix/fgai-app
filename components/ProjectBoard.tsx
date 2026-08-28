"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, Role } from "@/lib/types";
import { createProject, requestJoin, approveJoin, rejectJoin, deleteProject, signOut } from "@/app/projects/actions";
import { useFgTheme, Icon, Hov } from "@/components/studio/ui";
import FGLogo from "@/components/FGLogo";

type Pending = { requestId: string; user_id: string; email: string };
const COVERS = [
  "radial-gradient(120% 140% at 80% 10%, #2b3a6e, #131a33 60%),linear-gradient(160deg,#1a2348,#0d1530)",
  "radial-gradient(120% 140% at 80% 10%, #1f4d46, #0a1f1a 60%),linear-gradient(160deg,#13352f,#08130f)",
  "radial-gradient(120% 140% at 80% 10%, #4a2f5e, #1a1030 60%),linear-gradient(160deg,#2e1f48,#120d1f)",
  "radial-gradient(120% 140% at 80% 10%, #5e3030, #2a1010 60%),linear-gradient(160deg,#48201f,#1f0d0d)",
  "radial-gradient(120% 140% at 80% 10%, #2b5a6e, #0a2230 60%),linear-gradient(160deg,#1a3f48,#08171f)",
];
const ORBS = ["radial-gradient(circle at 38% 34%, #ffc0a6, #ea8190 46%, transparent 80%)", "radial-gradient(circle at 38% 34%, #a6ffd0, #5ad2a0 46%, transparent 80%)", "radial-gradient(circle at 38% 34%, #c0a6ff, #8a6bd0 46%, transparent 80%)"];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function ago(iso: string) { const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 3600) return Math.max(1, Math.floor(d / 60)) + " 分钟前"; if (d < 86400) return Math.floor(d / 3600) + " 小时前"; if (d < 604800) return Math.floor(d / 86400) + " 天前"; return new Date(iso).toLocaleDateString("zh-CN"); }
const EMOJIS = ["✦", "✺", "❂", "✸", "❖", "✶"];

export default function ProjectBoard({
  projects, myRole, myApplied, pending, counts, membersByProject, epCount, genCount, userId, userEmail, isAdmin, isSuperadmin,
}: {
  projects: Project[]; myRole: Record<string, Role>; myApplied: string[];
  pending: Record<string, Pending[]>; counts: Record<string, number>;
  membersByProject: Record<string, { ini: string; bg: string }[]>; epCount: Record<string, number>;
  genCount: number; userId: string; userEmail: string; isAdmin: boolean; isSuperadmin: boolean;
}) {
  const router = useRouter();
  const { theme, toggle } = useFgTheme();
  const [tab, setTab] = useState<"all" | "mine" | "active" | "draft">("all");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendOpen, setPendOpen] = useState(false);
  const applied = new Set(myApplied);

  const statusOf = (p: Project) => (epCount[p.id] > 0 ? "进行中" : "草稿");
  const stageNoOf = (p: Project) => (epCount[p.id] > 0 ? 2 : 1);
  const cover = (p: Project) => (p.cover && p.cover.startsWith("linear") ? p.cover : COVERS[hash(p.id) % COVERS.length]);
  const genre = (p: Project) => (p.story_bible as any)?.genre || "漫剧";

  const filtered = useMemo(() => projects.filter((p) => {
    if (tab === "mine" && !myRole[p.id]) return false;
    if (tab === "active" && statusOf(p) !== "进行中") return false;
    if (tab === "draft" && statusOf(p) !== "草稿") return false;
    if (q && !(p.name + genre(p)).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [projects, tab, q, myRole, epCount]);

  const mineCount = projects.filter((p) => myRole[p.id]).length;
  const activeCount = projects.filter((p) => statusOf(p) === "进行中").length;
  const draftCount = projects.filter((p) => statusOf(p) === "草稿").length;
  const pendList = Object.entries(pending).flatMap(([pid, ps]) => ps.map((x) => ({ ...x, projectId: pid, projectName: projects.find((p) => p.id === pid)?.name || "" })));
  const resume = projects.find((p) => myRole[p.id]);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const meIni = (userEmail || "?").replace(/@.*/, "").slice(0, 2).toUpperCase();

  async function onCreate() {
    if (!name.trim()) return; setBusy(true);
    const fd = new FormData(); fd.set("name", name.trim()); fd.set("summary", summary.trim()); fd.set("cover", ""); fd.set("emoji", EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
    const r: any = await createProject(fd); setBusy(false);
    if (r?.error) { alert("创建失败：" + r.error); return; }
    setShowNew(false); setName(""); setSummary(""); router.refresh();
  }
  async function onJoin(id: string) { const r: any = await requestJoin(id); if (r?.error) { alert("申请失败：" + r.error); return; } router.refresh(); }
  async function onApprove(p: any) { const r: any = await approveJoin(p.requestId, p.projectId, p.user_id); if (r?.error) { alert("批准失败：" + r.error); return; } router.refresh(); }
  async function onReject(p: any) { const r: any = await rejectJoin(p.requestId, p.projectId, p.user_id); if (r?.error) { alert("拒绝失败：" + r.error); return; } router.refresh(); }
  async function onDelete(id: string, nm: string) { if (!confirm(`删除项目「${nm}」？剧本/分镜/资产将一并永久删除,不可恢复。`)) return; setBusy(true); const r: any = await deleteProject(id); setBusy(false); if (r?.error) { alert("删除失败：" + r.error); return; } router.refresh(); }

  const railItem = (label: string, d: string[], active: boolean, href?: string, badge?: string, onClick?: () => void) => (
    <Hov as={href ? "a" : "button"} href={href} onClick={onClick}
      base={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 13, cursor: "pointer", color: active ? "var(--text)" : "var(--text-2)", background: active ? "var(--panel-2)" : "transparent", border: `1px solid ${active ? "var(--stroke-2)" : "transparent"}`, boxShadow: active ? "var(--inset)" : "none", fontSize: 14, fontWeight: active ? 500 : 400, width: "100%", textAlign: "left", transition: "all .3s var(--ease)" }}
      hover={active ? undefined : { color: "var(--text)", background: "var(--panel)" }}>
      <span style={{ color: active ? "var(--accent)" : "currentColor", display: "flex" }}><Icon d={d} size={19} sw={1.7} /></span>{label}
      {badge && <span className="fg-mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{badge}</span>}
    </Hov>
  );

  return (
    <div data-theme={theme} className="fg2" style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontSize: 15, lineHeight: 1.55, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(700px 540px at 100% 14%, var(--glow-coral), transparent 60%), radial-gradient(760px 600px at 2% -8%, var(--glow-b), transparent 58%)", animation: "glowpulse 16s var(--ease) infinite" }} />
      </div>

      {/* TOP BAR */}
      <header style={{ position: "relative", zIndex: 5, flex: "none", height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 22px", borderBottom: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(22px) saturate(1.4)", WebkitBackdropFilter: "blur(22px) saturate(1.4)", boxShadow: "var(--inset)" }}>
        <a href="/workspace" title="返回工作区" style={{ display: "flex", alignItems: "center", gap: 11, color: "inherit", textDecoration: "none" }}>
          <FGLogo size={38} />
          <div><div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.3px" }}>FG Studio</div><div className="fg-mono" style={{ fontSize: 9.5, letterSpacing: 1, color: "var(--text-3)" }}>AI 漫剧工业化平台</div></div>
        </a>
        <div style={{ flex: 1, maxWidth: 460, marginLeft: 18, display: "flex", alignItems: "center", gap: 10, height: 40, padding: "0 14px", borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>
          <Icon d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"]} size={17} sw={1.7} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目、题材……" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }} />
        </div>
        <div style={{ flex: 1 }} />
        <Hov as="button" onClick={toggle} title="日/夜" base={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }} hover={{ color: "var(--text)", background: "var(--panel-2)" }}>
          {theme === "dark" ? <Icon d={["M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"]} size={19} /> : <Icon d={["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z"]} size={19} />}
        </Hov>
        <Hov as="button" onClick={() => signOut()} title="退出登录" base={{ height: 38, padding: "0 13px", borderRadius: 11, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }} hover={{ color: "var(--text)", background: "var(--panel-2)" }}>退出</Hov>
        <div className="fg-mono" style={{ width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }}>{meIni}</div>
      </header>

      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex" }}>
        {/* LEFT RAIL */}
        <aside className="fg-rail" style={{ flex: "none", width: 230, display: "flex", flexDirection: "column", gap: 4, padding: "22px 16px", borderRight: "1px solid var(--stroke)" }}>
          <div className="fg-mono" style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-3)", padding: "6px 12px 10px" }}>工作区</div>
          {railItem("超级画布", ["M4 5h16v14H4z", "M8 9h8M8 13h5", "m15 5-3-3-3 3"], false, "/creator")}
          {railItem("AI 对话", ["M5 5h14a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-7l-4 3v-3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z", "M8 10h.01M12 10h.01M16 10h.01"], false, "/chat")}
          {railItem("项目", ["M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"], true, undefined, String(projects.length))}
          {railItem("预设库", ["M4 6h8M16 6h4M4 12h2M10 12h10M4 18h6M14 18h6", "M14 6a2 2 0 1 0-4 0 2 2 0 0 0 4 0", "M10 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0", "M16 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0"], false, "/presets")}
          {isAdmin && railItem("管理后台", ["M12 3 5 6v5c0 4.6 3.1 7.7 7 9 3.9-1.3 7-4.4 7-9V6l-7-3Z"], false, "/admin")}
          <div style={{ flex: 1 }} />
          <div style={{ padding: 14, borderRadius: 15, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, fontWeight: 500 }}><span style={{ color: "var(--accent)", display: "flex" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.8} /></span>我的生成</div>
            <div style={{ height: 7, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden", marginBottom: 7 }}><div style={{ width: Math.min(100, (genCount / 200) * 100) + "%", height: "100%", borderRadius: 6, background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} /></div>
            <div className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{genCount} 次出图</div>
          </div>
          {railItem("个人中心", ["M12 8a4 4 0 1 0 0-.01", "M4 21c0-4 3.6-7 8-7s8 3 8 7"], false, "/me")}
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, minWidth: 0, padding: "30px 36px 60px" }}>
          {/* HERO */}
          <section style={{ display: "flex", gap: 22, alignItems: "stretch", marginBottom: 34, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", justifyContent: "center", padding: "30px 34px", borderRadius: 24, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset),var(--shadow)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", right: -40, bottom: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, var(--glow-coral), transparent 70%)", pointerEvents: "none" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</span>
                <span className="fg-script" style={{ fontSize: 23, color: "var(--accent)", lineHeight: 1, transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>let&apos;s create</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 33, fontWeight: 700, letterSpacing: "-1px", lineHeight: 1.06 }}>{greeting}，{userEmail.replace(/@.*/, "")}</h1>
              <div style={{ marginTop: 20, display: "flex", gap: 22 }}>
                {[["进行中", activeCount], ["我参与", mineCount], ["待审批", pendList.length]].map(([l, v], i) => (
                  <div key={l as string} style={{ display: "flex", alignItems: "stretch", gap: 22 }}>
                    {i > 0 && <div style={{ width: 1, background: "var(--stroke)" }} />}
                    <div><div className="fg-mono" style={{ fontSize: 24, fontWeight: 600, color: i === 2 && (v as number) > 0 ? "var(--accent)" : "var(--text)" }}>{v}</div><div style={{ fontSize: 12, color: "var(--text-3)" }}>{l}</div></div>
                  </div>
                ))}
              </div>
            </div>
            {resume && (
              <Hov as="a" href={`/projects/${resume.id}/script`} base={{ flex: "none", width: 330, display: "flex", flexDirection: "column", borderRadius: 24, overflow: "hidden", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", boxShadow: "var(--inset),var(--shadow)", cursor: "pointer", transition: "all .35s var(--ease)" }} hover={{ transform: "translateY(-4px)", borderColor: "var(--accent)" }}>
                <div style={{ height: 128, position: "relative", background: cover(resume), overflow: "hidden" }}>
                  <div className="fg-mono" style={{ position: "absolute", left: 16, top: 14, fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,.7)", padding: "3px 8px", borderRadius: 7, background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.18)" }}>继续上次</div>
                  <div style={{ position: "absolute", left: 16, bottom: 12, color: "#fff" }}><div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.4px" }}>{resume.name}</div><div style={{ fontSize: 11.5, opacity: 0.7 }}>{genre(resume)}</div></div>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>阶段 {String(stageNoOf(resume)).padStart(2, "0")} / 07 · {stageNoOf(resume) > 1 ? "剧本工作台" : "立项 · 故事圣经"}</div><div style={{ height: 6, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ width: (stageNoOf(resume) / 7) * 100 + "%", height: "100%", borderRadius: 6, background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} /></div></div>
                  <span style={{ flex: "none", width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 8px 20px -8px var(--accent)" }}><Icon d={["M7 17 17 7M9 7h8v8"]} size={18} sw={2} /></span>
                </div>
              </Hov>
            )}
          </section>

          {/* TOOLBAR */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-.3px" }}>我的项目</h2>
            <div style={{ display: "flex", padding: 4, borderRadius: 13, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
              {([["all", "全部", projects.length], ["mine", "我参与", mineCount], ["active", "进行中", activeCount], ["draft", "草稿", draftCount]] as const).map(([k, l, c]) => { const on = tab === k; return (
                <button key={k} onClick={() => setTab(k as any)} style={{ padding: "7px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none" }}>{l}<span className="fg-mono" style={{ fontSize: 10.5, marginLeft: 6, color: "var(--text-3)" }}>{c}</span></button>
              ); })}
            </div>
            <div style={{ flex: 1 }} />
            {pendList.length > 0 && <Hov as="button" onClick={() => setPendOpen(true)} base={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--accent)", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }} hover={{ filter: "brightness(1.05)" }}>{pendList.length} 个加入申请</Hov>}
            <Hov as="button" onClick={() => setShowNew(true)} base={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 6px 0 16px", borderRadius: 13, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)" }} hover={{ filter: "brightness(1.08)" }}>新建项目<span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M12 5v14M5 12h14"]} size={15} sw={2} /></span></Hov>
          </div>

          {/* GRID */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(304px,1fr))", gap: 20 }}>
            {filtered.map((p) => {
              const isMember = !!myRole[p.id]; const isOwner = p.created_by === userId; const canDelete = isOwner || isSuperadmin; const st = statusOf(p); const sn = stageNoOf(p);
              const team = membersByProject[p.id] || []; const total = counts[p.id] || 1;
              const inner = (
                <>
                  <div style={{ height: 152, position: "relative", background: cover(p), overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: -30, right: -26, width: 120, height: 120, borderRadius: "50%", background: ORBS[hash(p.id) % ORBS.length], opacity: 0.6 }} />
                    <div style={{ position: "absolute", left: 14, top: 14, display: "flex", gap: 7 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "#fff", padding: "3px 9px", borderRadius: 8, background: "rgba(0,0,0,.32)", border: "1px solid rgba(255,255,255,.2)", backdropFilter: "blur(8px)" }}>{genre(p)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 500, color: st === "进行中" ? "#74f08e" : "#ffc06a", padding: "3px 9px", borderRadius: 8, background: "rgba(0,0,0,.32)", border: "1px solid rgba(255,255,255,.18)", backdropFilter: "blur(8px)" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />{st}</span>
                    </div>
                    {canDelete && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(p.id, p.name); }} title={isSuperadmin && !isOwner ? "以超级管理员身份删除项目" : "删除项目"} style={{ position: "absolute", right: 12, top: 12, width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", cursor: "pointer", color: "#fff", background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.2)", backdropFilter: "blur(8px)" }}><Icon d={["M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"]} size={14} sw={1.7} /></button>}
                    <div style={{ position: "absolute", left: 16, bottom: 13, color: "#fff" }}>
                      <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.4px", textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>{p.name}</div>
                      <div className="fg-mono" style={{ fontSize: 11, opacity: 0.78, letterSpacing: 1 }}>#{p.id.slice(0, 6).toUpperCase()}</div>
                    </div>
                  </div>
                  <div style={{ padding: "15px 16px 16px", display: "flex", flexDirection: "column", gap: 13 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{sn > 1 ? "剧本工作台" : "立项 · 故事圣经"}</span><span className="fg-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{String(sn).padStart(2, "0")} / 07</span></div>
                      <div style={{ display: "flex", gap: 4 }}>{Array.from({ length: 7 }).map((_, i) => <div key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i < sn ? "var(--accent)" : "var(--stroke)" }} />)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {team.map((m, i) => <div key={i} className="fg-mono" style={{ width: 26, height: 26, borderRadius: "50%", marginRight: -7, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, color: "#fff", background: m.bg, border: "2px solid var(--panel-solid)" }}>{m.ini}</div>)}
                        <span style={{ marginLeft: 14, fontSize: 11.5, color: "var(--text-3)" }}>{total} 人{total > team.length ? "" : ""}</span>
                      </div>
                      <span className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{ago(p.created_at)}</span>
                    </div>
                    {!isMember && (applied.has(p.id) ? <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-3)", padding: "6px 0" }}>申请审批中…</div> : <button onClick={(e) => { e.preventDefault(); onJoin(p.id); }} style={{ height: 36, borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 500, color: "var(--accent)", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>申请加入</button>)}
                  </div>
                </>
              );
              return isMember
                ? <Hov as="a" key={p.id} href={`/projects/${p.id}/script`} base={{ display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", cursor: "pointer", transition: "all .35s var(--ease)" }} hover={{ transform: "translateY(-5px)", borderColor: "var(--stroke-2)", boxShadow: "var(--inset),var(--shadow)" }}>{inner}</Hov>
                : <div key={p.id} style={{ display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>{inner}</div>;
            })}
            <Hov as="button" onClick={() => setShowNew(true)} base={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: 330, borderRadius: 20, cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1.5px dashed var(--stroke-2)", transition: "all .35s var(--ease)" }} hover={{ color: "var(--text)", borderColor: "var(--accent)", background: "var(--panel)" }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)" }}><Icon d={["M12 5v14M5 12h14"]} size={24} sw={1.6} /></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>新建漫剧项目</div><div style={{ fontSize: 12, marginTop: 3 }}>从灵感或预设开始</div></div>
            </Hov>
          </div>
        </main>
      </div>

      {/* 新建项目 */}
      {showNew && (
        <div onClick={() => setShowNew(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "100%", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 22, padding: 24, boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>新建漫剧项目</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 18 }}>先起个名,之后在「立项 · 故事圣经」里完善设定。</div>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>项目名称</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCreate(); }} placeholder="如：量子末日" style={{ width: "100%", height: 44, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 14px", color: "var(--text)", outline: "none", fontSize: 14, margin: "7px 0 14px" }} />
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>一句话简介（可选）</label>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="如：深空观测站的孤独与接触" style={{ width: "100%", height: 44, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 14px", color: "var(--text)", outline: "none", fontSize: 14, margin: "7px 0 18px" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowNew(false)} style={{ height: 40, padding: "0 16px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>取消</button>
              <button onClick={onCreate} disabled={busy || !name.trim()} style={{ height: 40, padding: "0 18px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !name.trim() ? 0.5 : 1 }}>{busy ? "创建中…" : "创建项目"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 加入申请审批 */}
      {pendOpen && (
        <div onClick={() => setPendOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", maxHeight: "80vh", overflow: "auto", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 22, padding: 22, boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>加入申请</div>
            {pendList.length === 0 ? <div style={{ color: "var(--text-3)", fontSize: 13 }}>暂无</div> : pendList.map((p) => (
              <div key={p.requestId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--stroke)" }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13.5 }}>{p.email}</div><div style={{ fontSize: 11.5, color: "var(--text-3)" }}>申请加入「{p.projectName}」</div></div>
                <button onClick={() => onReject(p)} style={{ height: 34, padding: "0 12px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#ff9e9e", background: "rgba(222,72,72,.12)", border: "1px solid rgba(222,72,72,.36)" }}>拒绝</button>
                <button onClick={() => onApprove(p)} style={{ height: 34, padding: "0 14px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none" }}>批准</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
