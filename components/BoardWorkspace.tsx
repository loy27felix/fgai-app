"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields, Episode, Scene } from "@/lib/types";
import { addShot } from "@/app/projects/[id]/board/actions";
import { IMG_MODELS, sizeFor } from "@/lib/imageModels";
import { generateImage } from '@/lib/ai/image-client';
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov } from "@/components/studio/ui";

type ShotRow = {
  id: string; scene_id: string; no: string; title?: string | null;
  time_start?: string | null; time_end?: string | null; duration_s?: number | null;
  script_beat?: Record<string, string> | null; frame_path?: string | null; roles?: string[] | null;
};
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const fu = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);
const pad = (n: number) => "EP" + String(n).padStart(2, "0");
function framePrompt(sh: ShotRow) {
  const b = sh.script_beat || {};
  return `黑白电影手绘分镜线稿（storyboard sketch, black-and-white pencil / ink），只表现镜头构图、人物站位与镜头语言，灰度速写质感，不要上色、不要文字、不要水印、不要字幕。\n景别：${b["景别"] || ""}\n画面：${b["画面"] || sh.title || ""}\n运镜：${b["运镜"] || ""}\n动作：${b["动作"] || ""}\n角色：${(sh.roles || []).join("、")}`;
}

export default function BoardWorkspace({
  projectId, projectName, canEdit, bible, episodes, scenes, shots, scriptText,
}: {
  projectId: string; projectName: string; canEdit: boolean; bible: BibleFields;
  episodes: Episode[]; scenes: Scene[]; shots: ShotRow[]; scriptText: string;
}) {
  const router = useRouter();
  const [epId, setEpId] = useState<string | null>(episodes[0]?.id || null);
  const [view, setView] = useState<"table" | "gallery">("table");
  const [filter, setFilter] = useState<"all" | "done" | "todo">("all");
  const [mode, setMode] = useState<"chat" | "gen">("chat");
  const [selId, setSelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const [gModel, setGModel] = useState(IMG_MODELS[0].id);

  const curEp = episodes.find((e) => e.id === epId) || episodes[0] || null;
  const epSceneIds = new Set(scenes.filter((s) => s.episode_id === epId).map((s) => s.id));
  const epShots = useMemo(() => shots.filter((s) => epSceneIds.has(s.scene_id)).sort((a, b) => (a.no || "").localeCompare(b.no || "", "zh", { numeric: true })), [shots, epId]);
  const shown = epShots.filter((s) => filter === "all" || (filter === "done" ? s.frame_path : !s.frame_path));
  const done = epShots.filter((s) => s.frame_path).length;
  const totalDur = epShots.reduce((s, x) => s + (x.duration_s || 0), 0);
  const selShot = epShots.find((s) => s.id === selId) || null;

  const bibleText = [bible.style && `画风/主色调：${bible.style}`, bible.characters && `主要人物：${bible.characters}`, bible.worldRules && `世界观：${bible.worldRules}`].filter(Boolean).join("\n");
  const chatSystem = `你是 FG Studio 的导演 AI，为 AI 漫剧《${projectName}》做分镜。依据故事圣经与剧本镜头，建议每个镜头的景别、运镜、构图与情绪，并能写出"手绘分镜图"的出图提示词。\n\n=== 故事圣经 ===\n${bibleText || "（未填）"}\n\n=== 剧本节选 ===\n${scriptText ? scriptText.slice(0, 4000) : "（暂无）"}`;

  async function genFrame(sh: ShotRow) {
    setBusyId(sh.id);
    try {
      await generateImage({ projectId, shotId: sh.id, shotField: "frame_path", model: gModel, size: sizeFor(gModel, "16:9"), prompt: framePrompt(sh) });
      router.refresh();
    } catch (error: any) {
      alert("生成失败：" + (error?.message || ""));
    } finally { setBusyId(null); }
  }
  async function genMissing() {
    const todo = epShots.filter((s) => !s.frame_path); if (!todo.length) { alert("本集镜头都已绘制。"); return; }
    setBatch(true);
    try {
      for (const sh of todo) {
        setBusyId(sh.id);
        await generateImage({ projectId, shotId: sh.id, shotField: "frame_path", model: gModel, size: sizeFor(gModel, "16:9"), prompt: framePrompt(sh) });
      }
      router.refresh();
    } catch (error: any) {
      alert("批量生成已停止：" + (error?.message || ""));
    }
    finally { setBatch(false); setBusyId(null); }
  }
  async function addRow() { const sid = scenes.filter((s) => s.episode_id === epId)[0]?.id; if (sid) { await addShot(projectId, sid); router.refresh(); } else alert("本集还没有场次，先去剧本工作台建场次。"); }

  const beat = (s: ShotRow, k: string) => (s.script_beat || {})[k] || "";
  const stChip = (s: ShotRow) => s.frame_path ? { t: "已绘制", ink: "var(--accent)" } : { t: "待生成", ink: "var(--text-3)" };
  const toolBtn = { display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" };

  // ---------- RIGHT ----------
  const right = (
    <aside style={{ flex: "none", width: 380, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)" }}>
      <div style={{ flex: "none", padding: "14px 16px 12px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", padding: 4, borderRadius: 13, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 4 }}>
          {([["chat", "对话", ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]], ["gen", "生成分镜图", ["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]]] as const).map(([k, lbl, d]) => { const on = mode === k; return <button key={k} onClick={() => setMode(k as any)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--accent-ink)" : "var(--text-2)", background: on ? "var(--accent)" : "transparent", border: "none" }}><Icon d={d} size={16} sw={1.7} />{lbl}</button>; })}
        </div>
      </div>
      <div style={{ flex: "none", display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--stroke)" }}>
        {[["镜头", String(epShots.length)], ["总时长", totalDur ? totalDur + "s" : "—"], ["已绘制", `${done}/${epShots.length}`]].map(([l, v], i) => (
          <div key={l} style={{ flex: 1, textAlign: "center", padding: 8, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}><div className="fg-mono" style={{ fontSize: 17, fontWeight: 600, color: i === 2 ? "var(--accent)" : "var(--text)" }}>{v}</div><div style={{ fontSize: 10, color: "var(--text-3)" }}>{l}</div></div>
        ))}
      </div>
      {mode === "chat" ? (
        <AiPanel embedded projectId={projectId} scope="board" title="导演 AI" badge="FG-Director" contextNote={bibleText ? "已读取 故事圣经 · 剧本" : "圣经/剧本待完善"} system={chatSystem}
          quick={["这个镜头景别建议", "给本集运镜设计", "写手绘分镜图提示词"]} placeholder="讨论镜头的景别、运镜与情绪……（⌘↵）" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ flex: "none", padding: "11px 16px", borderBottom: "1px solid var(--stroke)", display: "flex", gap: 8 }}>
            <div style={{ flex: 1, display: "grid", placeItems: "center", height: 36, borderRadius: 11, fontSize: 12.5, fontWeight: 500, color: "var(--accent-ink)", background: "var(--accent)" }}>对话式生图</div>
            <button onClick={() => router.push(`/projects/${projectId}/board/canvas`)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 36, borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M6 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M18 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M8.2 7 15.5 11M8.2 17 15.5 13"]} size={14} sw={1.7} />画布式</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
            {!selShot ? <div style={{ margin: "30px auto", textAlign: "center", color: "var(--text-3)", fontSize: 13, lineHeight: 1.7, maxWidth: 240 }}>在左侧表格点一个镜头,这里就能为它生成手绘分镜图。</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="fg-mono" style={{ fontSize: 15, fontWeight: 600 }}>镜头{selShot.no}</span><span style={{ fontSize: 13.5, fontWeight: 600 }}>{selShot.title || ""}</span></div>
                <div style={{ aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--stroke-2)", display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{fu(selShot.frame_path) ? <img src={fu(selShot.frame_path) as string} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (busyId === selShot.id ? "生成中…" : "尚无分镜图")}</div>
                {["景别", "画面", "运镜", "动作"].map((k) => beat(selShot, k) && (
                  <div key={k} style={{ fontSize: 12.5, lineHeight: 1.5 }}><span style={{ color: "var(--text-3)" }}>{k}：</span><span style={{ color: "var(--text-2)" }}>{beat(selShot, k)}</span></div>
                ))}
                <select value={gModel} onChange={(e) => setGModel(e.target.value)} className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 8px", cursor: "pointer" }}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                {canEdit && <button onClick={() => genFrame(selShot)} disabled={busyId === selShot.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 13, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 9px 22px -10px var(--accent)", opacity: busyId === selShot.id ? 0.6 : 1 }}><Icon d={["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]} size={16} sw={1.8} />{busyId === selShot.id ? "生成中…" : selShot.frame_path ? "重新生成手绘分镜图" : "生成手绘分镜图"}</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );

  const cols = "58px 132px 90px 96px 78px 1fr 130px 120px";
  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="board" right={right}>
      {/* header / toolbar */}
      <div style={{ flex: "none", padding: "20px 28px 16px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
              <span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>SHOT LIST</span>
              <span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", lineHeight: 1, transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>storyboard</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>导演分镜表 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>逐镜手绘分镜图</span></h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
              {([["table", "表格", ["M3 6h18M3 12h18M3 18h18"]], ["gallery", "大图", ["M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"]]] as const).map(([k, l, d]) => { const on = view === k; return <button key={k} onClick={() => setView(k as any)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none" }}><Icon d={d} size={14} sw={1.7} />{l}</button>; })}
            </div>
            {canEdit && <Hov as="button" onClick={genMissing} base={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 6px 0 15px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", opacity: batch ? 0.6 : 1 }} hover={batch ? undefined : { filter: "brightness(1.08)" }}>{batch ? "批量生成中…" : "生成空缺画面"}<span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={2} /></span></Hov>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
            {episodes.map((e) => { const on = epId === e.id; return <button key={e.id} onClick={() => { setEpId(e.id); setSelId(null); }} style={{ padding: "7px 13px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none" }}>{pad(e.idx)}</button>; })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {([["all", "全部", epShots.length], ["done", "已绘制", done], ["todo", "待生成", epShots.length - done]] as const).map(([k, l, c]) => { const on = filter === k; return <button key={k} onClick={() => setFilter(k as any)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: on ? "var(--accent-ink)" : "var(--text-2)", background: on ? "var(--accent)" : "var(--panel)", border: `1px solid ${on ? "transparent" : "var(--stroke)"}` }}>{l}<span className="fg-mono" style={{ fontSize: 10, opacity: 0.7 }}>{c}</span></button>; })}
          </div>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {epShots.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-3)", padding: "70px 0" }}>本集还没有镜头。去「剧本工作台 → 分镜头剧本」让 AI 拆镜头,或下方手动添加。</div>
        ) : view === "table" ? (
          <div style={{ minWidth: 1024 }}>
            <div className="fg-mono" style={{ position: "sticky", top: 0, zIndex: 3, display: "grid", gridTemplateColumns: cols, padding: "0 28px", height: 44, alignItems: "center", background: "var(--panel)", backdropFilter: "blur(16px)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>
              <div>镜号</div><div>画面</div><div>景别</div><div>运镜</div><div>时长</div><div>台词 / 动作</div><div>角色</div><div>状态</div>
            </div>
            {shown.map((s) => { const on = selId === s.id; const st = stChip(s); const img = fu(s.frame_path); return (
              <div key={s.id} onClick={() => { setSelId(s.id); setMode("gen"); }} style={{ display: "grid", gridTemplateColumns: cols, padding: "0 28px", minHeight: 92, alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--stroke)", background: on ? "var(--row-hover)" : "transparent" }}>
                <span className="fg-mono" style={{ fontSize: 15, fontWeight: 600 }}>{s.no}</span>
                <div style={{ width: 116, height: 66, borderRadius: 11, overflow: "hidden", position: "relative", background: "var(--bg-2)", border: "1px solid var(--stroke-2)", display: "grid", placeItems: "center" }}>{img ? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "var(--text-3)" }}><Icon d={["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]} size={18} sw={1.5} /></span>}{busyId === s.id && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.45)", color: "#fff", fontSize: 10 }} className="fg-mono">生成中</span>}</div>
                <div><span style={{ display: "inline-flex", padding: "4px 9px", borderRadius: 8, fontSize: 12, color: "var(--text)", background: "var(--panel-2)", border: "1px solid var(--stroke)" }}>{beat(s, "景别") || "—"}</span></div>
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>{beat(s, "运镜") || "—"}</div>
                <div className="fg-mono" style={{ fontSize: 13 }}>{s.time_start ? `${s.time_start}${s.time_end ? "–" + s.time_end : ""}` : (s.duration_s ? s.duration_s + "s" : "—")}</div>
                <div style={{ paddingRight: 16, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-2)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as any}>{beat(s, "对白") || beat(s, "动作") || beat(s, "画面") || "—"}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{(s.roles || []).slice(0, 3).map((c, i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 7, fontSize: 11.5, color: "var(--text)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }} />{c}</span>)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 9, fontSize: 12, fontWeight: 500, color: st.ink, background: "var(--panel)", border: "1px solid var(--stroke)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: st.ink }} />{st.t}</span>{canEdit && !s.frame_path && <button onClick={(e) => { e.stopPropagation(); genFrame(s); }} disabled={busyId === s.id} title="生成手绘分镜图" style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--accent-ink)", background: "var(--accent)", border: "none" }}><Icon d={["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]} size={14} sw={1.8} /></button>}</div>
              </div>
            ); })}
            {canEdit && <div onClick={addRow} style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 28px", cursor: "pointer", color: "var(--text-3)" }}><span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", border: "1.5px dashed var(--stroke-2)" }}><Icon d={["M12 5v14M5 12h14"]} size={16} sw={1.8} /></span>添加镜头</div>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 18, padding: "22px 28px 60px" }}>
            {shown.map((s) => { const img = fu(s.frame_path); return (
              <div key={s.id} onClick={() => { setSelId(s.id); setMode("gen"); }} style={{ borderRadius: 16, overflow: "hidden", cursor: "pointer", background: "var(--panel)", border: `1px solid ${selId === s.id ? "var(--accent)" : "var(--stroke)"}`, boxShadow: "var(--inset)" }}>
                <div style={{ aspectRatio: "16/9", background: "var(--bg-2)", display: "grid", placeItems: "center", position: "relative" }}>{img ? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "var(--text-3)" }}><Icon d={["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]} size={24} sw={1.4} /></span>}{busyId === s.id && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.45)", color: "#fff" }} className="fg-mono">生成中…</span>}</div>
                <div style={{ padding: "11px 13px", display: "flex", alignItems: "center", gap: 8 }}><span className="fg-mono" style={{ fontSize: 14, fontWeight: 600 }}>{s.no}</span><span style={{ fontSize: 13, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || beat(s, "画面") || ""}</span><div style={{ flex: 1 }} />{canEdit && <button onClick={(e) => { e.stopPropagation(); genFrame(s); }} disabled={busyId === s.id} style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--accent-ink)", background: "var(--accent)", border: "none" }}><Icon d={["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"]} size={14} sw={1.8} /></button>}</div>
              </div>
            ); })}
          </div>
        )}
      </div>
    </StudioShell>
  );
}
