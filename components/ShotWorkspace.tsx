"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields, Episode, Scene } from "@/lib/types";
import { updateShot } from "@/app/projects/[id]/board/actions";
import { IMG_MODELS, sizeFor } from "@/lib/imageModels";
import { generateImage } from '@/lib/ai/image-client';
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov, EditArea } from "@/components/studio/ui";

type ShotRow = {
  id: string; scene_id: string; no: string; title?: string | null; time_start?: string | null; time_end?: string | null; duration_s?: number | null;
  script_beat?: Record<string, string> | null; roles?: string[] | null;
  frame_path?: string | null; keyframe_path?: string | null; storyboard_path?: string | null;
  keyframe_prompt?: string | null; storyboard_prompt?: string | null; video_prompt?: any; outputs?: any;
};
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const fu = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);
const pad = (n: number) => "EP" + String(n).padStart(2, "0");
const FORMATS = ["通用 I2V", "TapNow 格式", "LiblibAI 格式", "情绪导演 · Seedance"];
const COMBOS = [
  { id: "video", label: "仅视频 Prompt", out: { keyframe: false, storyboard: false, video: true }, d: ["M3 5h18v14H3z", "m10 9 5 3-5 3z"] },
  { id: "kf", label: "分镜图 + 视频", out: { keyframe: true, storyboard: false, video: true }, d: ["M3 3h18v18H3z", "M3 15l5-4 4 3", "M14 5h7M14 9h4"] },
  { id: "sb", label: "故事板 + 视频", out: { keyframe: false, storyboard: true, video: true }, d: ["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"] },
  { id: "all", label: "三者全出", out: { keyframe: true, storyboard: true, video: true }, d: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h16v7H4z"] },
] as const;

export default function ShotWorkspace({
  projectId, projectName, canEdit, bible, episodes, scenes, shots, scriptText,
}: {
  projectId: string; projectName: string; canEdit: boolean; bible: BibleFields;
  episodes: Episode[]; scenes: Scene[]; shots: ShotRow[]; scriptText: string;
}) {
  const router = useRouter();
  const [epId, setEpId] = useState<string | null>(episodes[0]?.id || null);
  const epSceneIds = useMemo(() => new Set(scenes.filter((s) => s.episode_id === epId).map((s) => s.id)), [scenes, epId]);
  const epShots = useMemo(() => shots.filter((s) => epSceneIds.has(s.scene_id)).sort((a, b) => (a.no || "").localeCompare(b.no || "", "zh", { numeric: true })), [shots, epId]);
  const [selId, setSelId] = useState<string | null>(epShots[0]?.id || null);
  const [gModel, setGModel] = useState(IMG_MODELS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [vpBusy, setVpBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [outOv, setOutOv] = useState<Record<string, any>>({});
  const [fmtOv, setFmtOv] = useState<Record<string, string>>({});

  const sel = epShots.find((s) => s.id === selId) || epShots[0] || null;
  const idx = sel ? epShots.findIndex((s) => s.id === sel.id) : -1;
  const outOf = (sh: ShotRow) => outOv[sh.id] ?? sh.outputs ?? { video: true };
  const fmtOf = (sh: ShotRow) => fmtOv[sh.id] ?? sh.video_prompt?.format ?? FORMATS[0];
  const beat = (sh: ShotRow, k: string) => (sh.script_beat || {})[k] || "";

  const bibleText = [bible.style && `画风/主色调：${bible.style}`, bible.characters && `主要人物：${bible.characters}`, bible.worldRules && `世界观：${bible.worldRules}`].filter(Boolean).join("\n");
  const chatSystem = `你是 FG Studio 的视频导演 AI，为 AI 漫剧《${projectName}》的图生视频(I2V)写「视频 Prompt」,并能优化关键帧/故事板提示词。输出含:运镜、主体动作、节奏与时长、镜头语言、光影、情绪。\n\n=== 故事圣经 ===\n${bibleText || "（未填）"}\n\n=== 剧本节选 ===\n${scriptText ? scriptText.slice(0, 3500) : "（暂无）"}`;

  function setCombo(sh: ShotRow, out: any) { setOutOv((o) => ({ ...o, [sh.id]: out })); if (canEdit) updateShot(projectId, sh.id, { outputs: out }); }
  async function genImg(sh: ShotRow, field: "keyframe_path" | "storyboard_path", prompt: string) {
    if (!prompt.trim()) { alert("先写该图的提示词。"); return; }
    setBusy(field + sh.id);
    try {
      await generateImage({ projectId, shotId: sh.id, shotField: field, model: gModel, size: sizeFor(gModel, "16:9"), prompt });
      router.refresh();
    } catch (error: any) {
      alert("生成失败：" + (error?.message || ""));
    } finally { setBusy(null); }
  }
  function savePrompt(sh: ShotRow, field: string, v: string) { if (canEdit) return updateShot(projectId, sh.id, { [field]: v }); }
  function saveVideo(sh: ShotRow, text: string) { if (canEdit) return updateShot(projectId, sh.id, { video_prompt: { text, format: fmtOf(sh) } }); }
  function setFmt(sh: ShotRow, f: string) { setFmtOv((o) => ({ ...o, [sh.id]: f })); if (canEdit) updateShot(projectId, sh.id, { video_prompt: { text: sh.video_prompt?.text || "", format: f } }); }
  async function genVideoPrompt(sh: ShotRow) {
    setVpBusy(true);
    try {
      const fmt = fmtOf(sh); const b = sh.script_beat || {};
      const sys = `你是图生视频(I2V)的视频提示词专家。按「${fmt}」的风格输出一段可直接粘贴使用的中文视频 Prompt:包含运镜、主体动作、节奏/时长、镜头语言、光影、情绪;物理化、可执行,不要文学修辞,不要 markdown 代码块。\n画风/基调：${bible.style || ""}`;
      const usr = `镜号${sh.no} ${sh.title || ""}\n景别：${b["景别"] || ""}\n画面：${b["画面"] || ""}\n运镜：${b["运镜"] || ""}\n动作：${b["动作"] || ""}\n声音：${b["声音"] || ""}\n对白：${b["对白"] || ""}\n时长：${sh.duration_s || 4}秒`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, model: "deepseek-flash", messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || "AI 失败");
      await updateShot(projectId, sh.id, { video_prompt: { text: data.content || "", format: fmt } }); router.refresh();
    } catch (e: any) { alert("生成失败：" + (e?.message || "")); } finally { setVpBusy(false); }
  }
  function copy(t: string) { navigator.clipboard?.writeText(t || ""); setCopied(true); setTimeout(() => setCopied(false), 1400); }

  const cardHead = (d: string[], title: string, tag: string, color = "var(--accent-2)") => (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 18px", borderBottom: "1px solid var(--stroke)" }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color }}><Icon d={d} size={15} sw={1.7} /></span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
      <span className="fg-mono" style={{ fontSize: 10, color: "var(--accent)", padding: "2px 7px", borderRadius: 6, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>{tag}</span>
    </div>
  );
  const genBtn = (label: string, on: boolean, click: () => void) => (
    <button onClick={click} disabled={!canEdit || on} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 18px -8px var(--accent)", opacity: on ? 0.6 : 1, alignSelf: "flex-start" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={15} sw={1.8} />{label}</button>
  );

  const right = <AiPanel embedded projectId={projectId} scope="shots" title="视频导演 AI" badge="FG-Video" contextNote={bibleText ? "已读取 故事圣经 · 剧本" : "圣经/剧本待完善"} system={chatSystem}
    quick={["写本镜视频Prompt", "强调情绪与节奏", "改成竖屏快节奏"]} placeholder="让 AI 输出/优化本镜的视频 Prompt……（⌘↵）" />;

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="shots" right={<aside style={{ flex: "none", width: 380, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)" }}>{right}</aside>}>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* FILMSTRIP */}
        <aside style={{ flex: "none", width: 172, display: "flex", flexDirection: "column", borderRight: "1px solid var(--stroke)", background: "var(--panel)" }}>
          <div style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 4, padding: "12px 12px 8px", borderBottom: "1px solid var(--stroke)" }}>
            {episodes.map((e) => { const on = epId === e.id; return <button key={e.id} onClick={() => { setEpId(e.id); const fs = shots.filter((s) => scenes.filter((x) => x.episode_id === e.id).map((x) => x.id).includes(s.scene_id)).sort((a, b) => (a.no || "").localeCompare(b.no || "", "zh", { numeric: true }))[0]; setSelId(fs?.id || null); }} className="fg-mono" style={{ padding: "4px 9px", borderRadius: 8, cursor: "pointer", fontSize: 11, color: on ? "var(--accent-ink)" : "var(--text-3)", background: on ? "var(--accent)" : "var(--bg-2)", border: "none" }}>{pad(e.idx)}</button>; })}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {epShots.length === 0 ? <div style={{ color: "var(--text-3)", fontSize: 12, textAlign: "center", padding: "20px 4px", lineHeight: 1.6 }}>本集无镜头,去分镜表/剧本建镜头</div> : epShots.map((s) => { const on = sel?.id === s.id; const img = fu(s.keyframe_path) || fu(s.frame_path); const hasVp = !!s.video_prompt?.text; return (
              <button key={s.id} onClick={() => setSelId(s.id)} style={{ display: "flex", flexDirection: "column", gap: 5, padding: 6, borderRadius: 11, cursor: "pointer", background: on ? "var(--panel-2)" : "transparent", border: `1px solid ${on ? "var(--accent)" : "var(--stroke)"}`, textAlign: "left" }}>
                <div style={{ aspectRatio: "16/9", borderRadius: 7, overflow: "hidden", background: "var(--bg-2)", display: "grid", placeItems: "center", position: "relative" }}>{img ? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "var(--text-3)" }} className="fg-mono" >—</span>}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="fg-mono" style={{ fontSize: 12, fontWeight: 600, color: on ? "var(--accent)" : "var(--text-2)" }}>{s.no}</span>{hasVp && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} title="已有视频Prompt" />}</div>
              </button>
            ); })}
          </div>
        </aside>

        {/* OUTPUT MAIN */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {!sel ? <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 14, padding: 30, textAlign: "center" }}>选一个镜头开始逐镜头设计。<br />镜头来自「剧本工作台 → 分镜头剧本」或「导演分镜表」。</div> : (() => {
            const out = outOf(sel); const combo = COMBOS.find((c) => JSON.stringify(c.out) === JSON.stringify(out))?.id || (out.keyframe && out.storyboard ? "all" : out.keyframe ? "kf" : out.storyboard ? "sb" : "video");
            return (
              <>
                <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 26px", borderBottom: "1px solid var(--stroke)" }}>
                  <button onClick={() => idx > 0 && setSelId(epShots[idx - 1].id)} disabled={idx <= 0} style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", opacity: idx <= 0 ? 0.4 : 1 }}><Icon d={["m15 6-6 6 6 6"]} size={17} sw={1.7} /></button>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="fg-mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.5px" }}>镜号 {sel.no}</span><span style={{ fontSize: 13, color: "var(--text-3)" }}>/ {epShots.length}</span></div>
                    <div style={{ marginTop: 3, fontSize: 13, color: "var(--text-2)" }}>{[beat(sel, "景别"), beat(sel, "运镜"), (sel.duration_s ? sel.duration_s + "s" : "")].filter(Boolean).join(" · ")}{beat(sel, "画面") ? " — " + beat(sel, "画面") : (sel.title ? " — " + sel.title : "")}</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => idx < epShots.length - 1 && setSelId(epShots[idx + 1].id)} disabled={idx >= epShots.length - 1} style={{ display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", opacity: idx >= epShots.length - 1 ? 0.4 : 1 }}>下一镜<Icon d={["m9 6 6 6-6 6"]} size={16} sw={1.7} /></button>
                </div>

                <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "14px 26px 0", flexWrap: "wrap" }}>
                  <span className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)" }}>输出组合</span>
                  <div style={{ display: "flex", padding: 3, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3, flexWrap: "wrap" }}>
                    {COMBOS.map((c) => { const on = combo === c.id; return <button key={c.id} onClick={() => setCombo(sel, c.out)} disabled={!canEdit} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none" }}><Icon d={c.d} size={14} sw={1.7} />{c.label}</button>; })}
                  </div>
                  <span className="fg-mono" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)" }}>图片模型</span>
                  <select value={gModel} onChange={(e) => setGModel(e.target.value)} className="fg-mono" style={{ maxWidth: 260, fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 9, padding: "7px 8px", cursor: "pointer" }}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 26px 36px", display: "flex", flexDirection: "column", gap: 18 }}>
                  {out.keyframe && (
                    <div style={{ flex: "none", borderRadius: 18, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
                      {cardHead(["M3 3h18v18H3z", "M9 9a2 2 0 1 0 0-.01", "m21 15-5-5L5 21"], "分镜关键帧", "图 + Prompt")}
                      <div style={{ padding: "16px 18px", display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 280 }}>
                          <div style={{ aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--stroke-2)", display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12, position: "relative" }}>{fu(sel.keyframe_path) ? <img src={fu(sel.keyframe_path) as string} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (busy === "keyframe_path" + sel.id ? "生成中…" : "尚无关键帧")}<a href={`/projects/${projectId}/shots/canvas?shot=${encodeURIComponent(sel.id)}`} title="打开本镜头独立画布" style={{ position: "absolute", right: 8, top: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "#fff", padding: "3px 8px", borderRadius: 7, background: "rgba(0,0,0,.42)" }} className="fg-mono"><Icon d={["M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M18 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M8.2 7 15.5 11"]} size={11} sw={1.8} />本镜画布</a></div>
                        </div>
                        <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 10 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>关键帧图 Prompt</span>
                          <EditArea key={"kf" + sel.id + (sel.keyframe_prompt || "").length} value={sel.keyframe_prompt || ""} disabled={!canEdit} minH={120} placeholder="关键帧画面提示词（人物/构图/光影/画风）。可让右侧 AI 写。" onSave={(v) => savePrompt(sel, "keyframe_prompt", v)} style={{ fontSize: 13 }} />
                          {genBtn(busy === "keyframe_path" + sel.id ? "生成中…" : "生成关键帧", busy === "keyframe_path" + sel.id, () => genImg(sel, "keyframe_path", sel.keyframe_prompt || ""))}
                        </div>
                      </div>
                    </div>
                  )}
                  {out.storyboard && (
                    <div style={{ flex: "none", borderRadius: 18, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
                      {cardHead(["M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z"], "手绘故事板", "图 + Prompt")}
                      <div style={{ padding: "16px 18px", display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 280, aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--stroke-2)", display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{fu(sel.storyboard_path) ? <img src={fu(sel.storyboard_path) as string} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (busy === "storyboard_path" + sel.id ? "生成中…" : "尚无故事板")}</div>
                        <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 10 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>故事板 Prompt</span>
                          <EditArea key={"sb" + sel.id + (sel.storyboard_prompt || "").length} value={sel.storyboard_prompt || ""} disabled={!canEdit} minH={112} placeholder="手绘故事板线稿提示词（构图、运镜箭头、黑白速写）。" onSave={(v) => savePrompt(sel, "storyboard_prompt", v)} style={{ fontSize: 13 }} />
                          {genBtn(busy === "storyboard_path" + sel.id ? "生成中…" : "生成故事板", busy === "storyboard_path" + sel.id, () => genImg(sel, "storyboard_path", sel.storyboard_prompt || ""))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ flex: "none", borderRadius: 18, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 18px", borderBottom: "1px solid var(--stroke)" }}>
                      <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={["M3 5h18v14H3z", "m10 9 5 3-5 3z"]} size={15} sw={1.7} /></span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>视频 Prompt</span>
                      <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "2px 7px", borderRadius: 6, border: "1px solid var(--stroke)" }}>纯文字 · 图生视频</span>
                      <div style={{ flex: 1 }} />
                      <select value={fmtOf(sel)} onChange={(e) => setFmt(sel, e.target.value)} disabled={!canEdit} style={{ height: 30, padding: "0 8px", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--stroke)", outline: "none", fontFamily: "inherit" }}>{FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                    </div>
                    <div style={{ padding: "16px 18px" }}>
                      <EditArea key={"vp" + sel.id + (sel.video_prompt?.text || "").length} value={sel.video_prompt?.text || ""} disabled={!canEdit} minH={180} placeholder="本镜的视频提示词。可点「AI 生成」按所选格式自动写,或在右侧用「情绪导演」技能对话生成。" onSave={(v) => saveVideo(sel, v)} style={{ fontSize: 13, lineHeight: 1.7 }} />
                      <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                        <button onClick={() => copy(sel.video_prompt?.text || "")} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 13px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["M9 9h13v13H9z", "M5 15V5a2 2 0 0 1 2-2h10"]} size={14} sw={1.7} />{copied ? "已复制" : "复制"}</button>
                        {canEdit && <button onClick={() => genVideoPrompt(sel)} disabled={vpBusy} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 13px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: vpBusy ? 0.6 : 1 }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={14} sw={1.8} />{vpBusy ? "生成中…" : "AI 生成"}</button>}
                        <div style={{ flex: 1 }} />
                        <a href="https://www.tapnow.ai" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))" }}>去 TapNow 生视频<Icon d={["M7 17 17 7M9 7h8v8"]} size={14} sw={1.9} /></a>
                        <a href="https://www.liblib.art" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 13px", borderRadius: 10, fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke-2)" }}>LiblibAI<Icon d={["M7 17 17 7M9 7h8v8"]} size={13} sw={1.8} /></a>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </main>
      </div>
    </StudioShell>
  );
}
