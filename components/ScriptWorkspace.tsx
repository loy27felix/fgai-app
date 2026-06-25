"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields, Episode, Scene } from "@/lib/types";
import { addEpisode, addScene, saveScript, rollbackScript } from "@/app/projects/[id]/script/actions";
import { createClient } from "@/lib/supabase/client";
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov } from "@/components/studio/ui";

type ScriptRow = { scene_id: string; body: string | null; current_version?: number | null };
type ShotRow = {
  id: string; scene_id: string; no: string; title?: string | null;
  time_start?: string | null; time_end?: string | null; duration_s?: number | null;
  script_beat?: Record<string, string> | null; roles?: string[] | null;
};
type Over = { ep: string; title: string; dur: string; event: string; hook: string };

const pad = (n: number) => "EP" + String(n).padStart(2, "0");
const BEAT_KEYS = ["景别", "画面", "运镜", "动作", "声音", "对白", "重点"];

export default function ScriptWorkspace({
  projectId, projectName, canEdit, bible, episodes, scenes, scripts, shots, overview,
}: {
  projectId: string; projectName: string; canEdit: boolean; bible: BibleFields;
  episodes: Episode[]; scenes: Scene[]; scripts: ScriptRow[]; shots: ShotRow[]; overview: any;
}) {
  const router = useRouter();
  const sb = createClient();
  const [panel, setPanel] = useState<"overview" | "full" | "shots">("overview");
  const [epId, setEpId] = useState<string | null>(episodes[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const [vhOpen, setVhOpen] = useState(false);
  const [vers, setVers] = useState<any[]>([]);
  const [olOpen, setOlOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const scenesOf = (id: string | null) => scenes.filter((s) => s.episode_id === id).sort((a, b) => a.idx - b.idx);
  const bodyOf = (sceneId: string) => scripts.find((x) => x.scene_id === sceneId)?.body || "";
  const curEp = episodes.find((e) => e.id === epId) || episodes[0] || null;
  const epScenes = scenesOf(epId);
  const epSceneIds = new Set(epScenes.map((s) => s.id));
  const epShots = shots.filter((sh) => epSceneIds.has(sh.scene_id))
    .sort((a, b) => (a.no || "").localeCompare(b.no || "", "zh", { numeric: true }));

  const structure: Over[] = useMemo(() => {
    if (overview?.structure?.length) return overview.structure as Over[];
    return episodes.map((e) => ({ ep: pad(e.idx), title: e.title || `第${e.idx}集`, dur: "—", event: "—", hook: "—" }));
  }, [overview, episodes]);
  const synopsis: string = overview?.synopsis || bible.logline || "";
  const totalDur: string = overview?.totalDur || `共 ${episodes.length} 集`;

  // ── 编剧 AI 系统提示（注入故事圣经记忆）──
  const bibleText = [
    bible.logline && `一句话梗概：${bible.logline}`, bible.genre && `题材/时长：${bible.genre}`,
    bible.worldRules && `世界观规则：${bible.worldRules}`, bible.style && `画风/主色调：${bible.style}`,
    bible.characters && `主要人物：${bible.characters}`, bible.taboos && `禁忌/全局负向词：${bible.taboos}`,
  ].filter(Boolean).join("\n");
  const system = `你是 FG Studio 的编剧 AI（FG-Writer），正在为 AI 漫剧竖屏短剧《${projectName}》创作。严格遵守该项目「故事圣经」的设定、人物性格、世界观与基调，保持口吻一致。\n\n=== 故事圣经 ===\n${bibleText || "（暂未填写，请提醒用户先完善故事圣经）"}\n\n输出规范：① 总览给「剧情介绍 + 结构总表（集数/标题/时长/核心事件/结尾钩子）」；② 完整剧本用「场次标题 + △动作描述 + 角色：台词（可标 OS/VO/字幕/闪回/空镜）」；③ 分镜头剧本逐镜输出「景别/画面/运镜/动作/声音/对白/重点」，每镜≤15 秒。直接给纯文本，不要 markdown 代码块。`;
  const ctxNote = bibleText ? "已读取 故事圣经 · 设定与人物" : "故事圣经尚未填写";

  async function uploadScript(file?: File | null) {
    if (!file) return;
    if (!epId) { alert("请先在「立项」或本页新建至少一集。"); return; }
    setBusy(true);
    try {
      const text = await file.text();
      let sceneId = epScenes[0]?.id;
      if (!sceneId) { const r: any = await addScene(projectId, epId); sceneId = r?.id; }
      if (sceneId) { await saveScript(projectId, sceneId, text, "upload"); router.refresh(); }
    } finally { setBusy(false); }
  }
  async function openVH() {
    setVhOpen(true); setVers([]);
    const sids = epScenes.map((s) => s.id); if (!sids.length) return;
    const { data: scs } = await sb.from("scripts").select("id,scene_id").in("scene_id", sids);
    const ids = (scs || []).map((x: any) => x.id); if (!ids.length) return;
    const { data: vs } = await sb.from("script_versions").select("id,script_id,version,source,created_at").in("script_id", ids).order("version", { ascending: false }).limit(40);
    setVers(vs || []);
  }
  async function rollback(scriptId: string, versionId: string) { await rollbackScript(projectId, scriptId, versionId); setVhOpen(false); router.refresh(); }

  async function addEp() { const r: any = await addEpisode(projectId); if (r?.id) setEpId(r.id); router.refresh(); }

  // ── panel tabs ──
  const PANELS = [
    { id: "overview", label: "总览", tag: "结构", d: ["M3 3h18v6H3z", "M3 13h8v8H3z", "M15 13h6v8h-6z"] },
    { id: "full", label: "分集完整剧本", tag: `${episodes.length} 集`, d: ["M4 4h16v16H4z", "M8 8h8M8 12h8M8 16h5"] },
    { id: "shots", label: "分镜头剧本", tag: `${epShots.length} 镜`, d: ["M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", "M12 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"] },
  ] as const;
  const headBtn = { display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 12px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" };
  const epTab = (id: string, label: string, on: boolean, set: () => void) => (
    <Hov as="button" key={id} onClick={set}
      base={{ padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none", transition: "all .3s var(--ease)" }}
      hover={on ? undefined : { color: "var(--text)" }}>{label}</Hov>
  );
  const beatColor = (k: string) => k === "对白" ? "var(--c-os)" : k === "重点" ? "var(--accent)" : "var(--text-2)";

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="script" saved="自动保存"
      right={<AiPanel projectId={projectId} scope="script" title="编剧 AI" badge="FG-Writer v2" contextNote={ctxNote} system={system}
        placeholder="让 AI 自动写本集剧本、按格式改写，或润色台词……（⌘↵）"
        quick={["自动写本集完整剧本", "把本集拆成分镜头剧本", "统一主角台词口吻"]}
        onAction={(a) => { if (a.includes("完整")) setPanel("full"); else if (a.includes("分镜头")) setPanel("shots"); }} />}>

      {/* panel tabs */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", flexWrap: "wrap", padding: "16px 30px 0", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {PANELS.map((p) => {
            const on = panel === p.id;
            return (
              <Hov as="button" key={p.id} onClick={() => setPanel(p.id as any)}
                base={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 14px", cursor: "pointer", fontSize: 14.5, fontWeight: on ? 600 : 500, color: on ? "var(--text)" : "var(--text-3)", background: "transparent", border: "none", transition: "all .3s var(--ease)" }}
                hover={on ? undefined : { color: "var(--text-2)" }}>
                <Icon d={p.d} size={16} sw={1.7} />{p.label}
                <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)", padding: "1px 6px", borderRadius: 6, background: "var(--bg-2)" }}>{p.tag}</span>
                <span style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 2.5, borderRadius: 3, background: on ? "var(--accent)" : "transparent" }} />
              </Hov>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}>
          <Hov as="button" onClick={() => setOlOpen(true)} base={headBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"]} size={15} sw={1.7} />大纲</Hov>
          <Hov as="button" onClick={openVH} base={headBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["M12 7v5l3 2", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"]} size={15} sw={1.7} />版本历史</Hov>
          {canEdit && <>
            <input ref={fileRef} type="file" accept=".txt,.md,.fountain,text/*" hidden onChange={(e) => { uploadScript(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            <Hov as="button" onClick={() => fileRef.current?.click()} base={headBtn} hover={{ color: "var(--text)", background: "var(--panel-2)" }}><Icon d={["M12 15V3m0 0 4 4m-4-4-4 4M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"]} size={15} sw={1.7} />{busy ? "上传中…" : "上传剧本"}</Hov>
          </>}
        </div>
      </div>

      {/* panel body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 30px 70px" }}>

        {/* ===== 总览 ===== */}
        {panel === "overview" && (
          <div style={{ maxWidth: 1000, margin: "0 auto", animation: "blurUp .5s var(--ease) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 10 }}>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>{projectName} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· 总览</span></h1>
              <span className="fg-script" style={{ fontSize: 24, color: "var(--accent)", transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>overview</span>
            </div>
            <p style={{ margin: "0 0 24px", maxWidth: 760, fontSize: 16, lineHeight: 1.8, color: "var(--text-2)" }}>{synopsis || "还没有剧情总览。在右侧让「编剧 AI」根据故事圣经生成剧情介绍与结构总表。"}</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>结构总表</span>
              <span className="fg-mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{totalDur}</span>
            </div>
            <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ display: "grid", gridTemplateColumns: "74px 1fr 70px 2fr 1.3fr", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>
                {["集数", "标题", "时长", "核心事件", "结尾钩子"].map((h) => <div key={h} style={{ padding: "12px 14px" }}>{h}</div>)}
              </div>
              {structure.length === 0 ? <div style={{ padding: "26px 14px", color: "var(--text-3)", fontSize: 13 }}>暂无分集。点击「大纲 → 新建集」或让 AI 生成结构。</div> :
                structure.map((o, i) => (
                  <Hov key={i} base={{ display: "grid", gridTemplateColumns: "74px 1fr 70px 2fr 1.3fr", alignItems: "center", background: i % 2 ? "var(--row)" : "transparent", borderBottom: "1px solid var(--stroke)", transition: "background .2s var(--ease)" }} hover={{ background: "var(--row-hover)" }}>
                    <div style={{ padding: "15px 14px" }}><span className="fg-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-ink)", background: "linear-gradient(150deg,var(--accent),var(--accent-2))", padding: "3px 8px", borderRadius: 7 }}>{o.ep}</span></div>
                    <div style={{ padding: "15px 14px", fontSize: 14, fontWeight: 600 }}>{o.title}</div>
                    <div className="fg-mono" style={{ padding: "15px 14px", fontSize: 13, color: "var(--text-2)" }}>{o.dur}</div>
                    <div style={{ padding: "15px 14px", fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>{o.event}</div>
                    <div style={{ padding: "15px 14px", fontSize: 13, lineHeight: 1.55, color: "var(--c-os)" }}>{o.hook}</div>
                  </Hov>
                ))}
            </div>
          </div>
        )}

        {/* ===== 分集完整剧本 ===== */}
        {panel === "full" && (
          <div style={{ maxWidth: 820, margin: "0 auto", animation: "blurUp .5s var(--ease) both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <div style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
                {episodes.length === 0 ? <span style={{ padding: "7px 12px", fontSize: 13, color: "var(--text-3)" }}>暂无分集</span> :
                  episodes.map((e) => epTab(e.id, pad(e.idx), epId === e.id, () => setEpId(e.id)))}
                {canEdit && <button onClick={addEp} title="新建集" style={{ padding: "7px 11px", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "var(--text-3)", background: "transparent", border: "none" }}>＋</button>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: "var(--text-3)" }}>
                {[["OS 画外音", "--c-os"], ["VO 旁白", "--c-vo"], ["字幕", "--c-sub"], ["闪回", "--c-flash"], ["空镜", "--c-empty"]].map(([l, c]) => (
                  <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 3, background: `var(${c})` }} />{l}</span>
                ))}
              </div>
            </div>
            <div style={{ borderRadius: 18, padding: "34px 40px 40px", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div style={{ textAlign: "center", marginBottom: 28, paddingBottom: 18, borderBottom: "1px dashed var(--stroke-2)" }}>
                <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1 }}>{curEp ? `第${curEp.idx}集 · ${curEp.title || ""}` : "未选择集"}</div>
                <div className="fg-mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{curEp ? pad(curEp.idx) : "—"} — FULL SCRIPT</div>
              </div>
              <article style={{ fontSize: 15.5, lineHeight: 1.95 }}>
                {epScenes.length === 0 ? <div style={{ textAlign: "center", color: "var(--text-3)", padding: "30px 0" }}>本集还没有场次/剧本。在右侧让 AI「自动写本集完整剧本」，或上传剧本。</div> :
                  epScenes.map((sc) => {
                    const body = bodyOf(sc.id);
                    return (
                      <div key={sc.id} style={{ marginBottom: 22 }}>
                        <div style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="fg-mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>第{sc.idx}场</span>
                          <span style={{ fontWeight: 600, letterSpacing: ".5px" }}>{sc.title || ""}{sc.setting ? ` · ${sc.setting}` : ""}</span>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", color: body ? "var(--text)" : "var(--text-3)" }}>{body || "（本场暂无剧本，可让 AI 生成或手动编写）"}</div>
                      </div>
                    );
                  })}
              </article>
            </div>
          </div>
        )}

        {/* ===== 分镜头剧本 ===== */}
        {panel === "shots" && (
          <div style={{ maxWidth: 880, margin: "0 auto", animation: "blurUp .5s var(--ease) both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <div style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
                {episodes.length === 0 ? <span style={{ padding: "7px 12px", fontSize: 13, color: "var(--text-3)" }}>暂无分集</span> :
                  episodes.map((e) => epTab("s" + e.id, pad(e.idx), epId === e.id, () => setEpId(e.id)))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="fg-mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{curEp ? pad(curEp.idx) : "—"} · 共 {epShots.length} 个镜头</span>
                <Hov as="a" href={`/projects/${projectId}/board`}
                  base={{ display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 13px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 18px -8px var(--accent)", transition: "all .3s var(--ease)" }}
                  hover={{ filter: "brightness(1.08)" }}>拆入导演分镜表<Icon d={["M5 12h14M13 6l6 6-6 6"]} size={15} sw={1.9} /></Hov>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {epShots.length === 0 ? <div style={{ textAlign: "center", color: "var(--text-3)", padding: "40px 0", border: "1.5px dashed var(--stroke-2)", borderRadius: 16 }}>本集还没有分镜头。在右侧让 AI「把本集拆成分镜头剧本」，每镜≤15 秒。</div> :
                epShots.map((sh) => {
                  const beat = sh.script_beat || {};
                  const rows = BEAT_KEYS.map((k) => [k, beat[k]]).filter(([, v]) => v) as [string, string][];
                  const time = sh.time_start || sh.time_end ? `${sh.time_start || ""}${sh.time_end ? "–" + sh.time_end : ""}` : (sh.duration_s ? `${sh.duration_s}s` : "");
                  return (
                    <div key={sh.id} style={{ borderRadius: 16, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid var(--stroke)", background: "var(--panel-2)" }}>
                        <span className="fg-mono" style={{ fontSize: 15, fontWeight: 600 }}>镜头{sh.no}</span>
                        <span style={{ width: 1, height: 14, background: "var(--stroke-2)" }} />
                        <span className="fg-mono" style={{ fontSize: 12.5, color: "var(--text-2)" }}>{time || "—"}</span>
                        <span style={{ width: 1, height: 14, background: "var(--stroke-2)" }} />
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{sh.title || ""}</span>
                        <div style={{ flex: 1 }} />
                        {beat["景别"] && <span style={{ fontSize: 11.5, color: "var(--text)", background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "3px 9px", borderRadius: 7 }}>{beat["景别"]}</span>}
                      </div>
                      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
                        {rows.length === 0 ? <span style={{ fontSize: 13, color: "var(--text-3)" }}>（该镜头暂无景别/画面等字段，去右侧让 AI 补全）</span> :
                          rows.map(([k, v]) => (
                            <div key={k} style={{ display: "flex", gap: 13, fontSize: 13.5, lineHeight: 1.6 }}>
                              <span style={{ flex: "none", width: 52, color: "var(--text-3)", fontWeight: 500 }}>{k}</span>
                              <span style={{ color: beatColor(k) }}>{v}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* 大纲 抽屉 */}
      {olOpen && (
        <div onClick={() => setOlOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", backdropFilter: "blur(6px)", display: "flex", justifyContent: "flex-start" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 320, maxWidth: "86%", height: "100%", background: "var(--panel-solid)", borderRight: "1px solid var(--stroke)", padding: "20px 18px", overflowY: "auto", boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}><b style={{ fontSize: 15 }}>大纲</b><div style={{ flex: 1 }} /><button onClick={() => setOlOpen(false)} style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 16 }}>✕</button></div>
            {episodes.map((e) => (
              <div key={e.id} style={{ marginBottom: 14 }}>
                <button onClick={() => { setEpId(e.id); setPanel("full"); setOlOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 13.5, fontWeight: 600, color: epId === e.id ? "var(--accent)" : "var(--text)", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>{pad(e.idx)} · {e.title || `第${e.idx}集`}</button>
                {scenesOf(e.id).map((s) => <div key={s.id} className="fg-mono" style={{ fontSize: 12, color: "var(--text-3)", padding: "2px 0 2px 14px" }}>第{s.idx}场 {s.title || ""}</div>)}
              </div>
            ))}
            {canEdit && <button onClick={addEp} style={{ marginTop: 8, fontSize: 13, color: "var(--accent)", background: "none", border: "1px dashed var(--stroke-2)", borderRadius: 10, padding: "8px 12px", cursor: "pointer", width: "100%" }}>＋ 新建一集</button>}
          </div>
        </div>
      )}

      {/* 版本历史 */}
      {vhOpen && (
        <div onClick={() => setVhOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", maxHeight: "80vh", overflow: "auto", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 20, padding: "20px 22px", boxShadow: "var(--shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}><b style={{ fontSize: 15 }}>版本历史 · {curEp ? pad(curEp.idx) : ""}</b><div style={{ flex: 1 }} /><button onClick={() => setVhOpen(false)} style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 16 }}>✕</button></div>
            {vers.length === 0 ? <div style={{ color: "var(--text-3)", fontSize: 13, padding: "20px 0", textAlign: "center" }}>本集暂无版本快照（保存或 AI 生成剧本后会自动记录）。</div> :
              vers.map((v) => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--stroke)" }}>
                  <span className="fg-mono" style={{ fontSize: 12, color: "var(--accent)" }}>v{v.version}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{v.source || "manual"}</span>
                  <span className="fg-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{new Date(v.created_at).toLocaleString("zh-CN")}</span>
                  <div style={{ flex: 1 }} />
                  {canEdit && <button onClick={() => rollback(v.script_id, v.id)} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "1px solid var(--stroke-2)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>回滚到此版本</button>}
                </div>
              ))}
          </div>
        </div>
      )}
    </StudioShell>
  );
}
