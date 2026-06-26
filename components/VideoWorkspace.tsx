"use client";
import { useMemo, useState } from "react";
import type { Episode, Scene } from "@/lib/types";
import { updateShot } from "@/app/projects/[id]/board/actions";
import StudioShell from "@/components/studio/StudioShell";
import { Icon } from "@/components/studio/ui";

type ShotRow = { id: string; scene_id: string; no: string; title?: string | null; duration_s?: number | null; keyframe_path?: string | null; frame_path?: string | null; video_prompt?: any; video_url?: string | null; roles?: string[] | null };
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const fu = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);
const pad = (n: number) => "EP" + String(n).padStart(2, "0");
const PLATFORMS = [
  { name: "TapNow", url: "https://www.tapnow.ai" },
  { name: "LiblibAI", url: "https://www.liblib.art" },
  { name: "可灵 Kling", url: "https://app.klingai.com" },
];

export default function VideoWorkspace({ projectId, projectName, canEdit, episodes, scenes, shots }: {
  projectId: string; projectName: string; canEdit: boolean; episodes: Episode[]; scenes: Scene[]; shots: ShotRow[];
}) {
  const [epId, setEpId] = useState<string | null>(episodes[0]?.id || null);
  const [copied, setCopied] = useState<string | null>(null);
  const epSceneIds = useMemo(() => new Set(scenes.filter((s) => s.episode_id === epId).map((s) => s.id)), [scenes, epId]);
  const epShots = useMemo(() => shots.filter((s) => epSceneIds.has(s.scene_id)).sort((a, b) => (a.no || "").localeCompare(b.no || "", "zh", { numeric: true })), [shots, epId]);
  const done = epShots.filter((s) => s.video_url).length;

  function copy(text: string, id: string) { navigator.clipboard?.writeText(text || ""); setCopied(id); setTimeout(() => setCopied(null), 1400); }
  function saveUrl(sh: ShotRow, v: string) { if (canEdit && v !== (sh.video_url || "")) updateShot(projectId, sh.id, { video_url: v || null }); }

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="video">
      <div style={{ flex: "none", padding: "20px 28px 16px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}><span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>RENDER</span><span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>to motion</span></div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>生视频 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>关键帧 + 视频Prompt → 外部平台</span></h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {PLATFORMS.map((p) => <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 14px", borderRadius: 12, fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>{p.name}<Icon d={["M7 17 17 7M9 7h8v8"]} size={14} sw={1.7} /></a>)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
            {episodes.map((e) => { const on = epId === e.id; return <button key={e.id} onClick={() => setEpId(e.id)} style={{ padding: "7px 13px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none" }}>{pad(e.idx)}</button>; })}
          </div>
          <span className="fg-mono" style={{ fontSize: 12, color: "var(--text-3)" }}>已回填成片 {done}/{epShots.length}</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 28px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
        {epShots.length === 0 ? <div style={{ textAlign: "center", color: "var(--text-3)", padding: "60px 0", border: "1.5px dashed var(--stroke-2)", borderRadius: 16 }}>本集还没有镜头。先到「逐镜头设计」备好关键帧 + 视频Prompt。</div> :
          epShots.map((sh) => { const kf = fu(sh.keyframe_path) || fu(sh.frame_path); const vp = sh.video_prompt?.text || ""; return (
            <div key={sh.id} style={{ display: "flex", gap: 16, padding: 16, borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", flexWrap: "wrap" }}>
              <div style={{ flex: "none", width: 200 }}>
                <div style={{ aspectRatio: "16/9", borderRadius: 11, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--stroke-2)", display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{kf ? <img src={kf} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "无关键帧"}</div>
                <div className="fg-mono" style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>镜 {sh.no} · {sh.duration_s || 4}s</div>
              </div>
              <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12.5, fontWeight: 600 }}>视频 Prompt</span><button onClick={() => copy(vp, sh.id)} style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-2)", border: "1px solid var(--stroke)", borderRadius: 7, padding: "3px 9px", cursor: "pointer" }}>{copied === sh.id ? "已复制 ✓" : "复制"}</button><div style={{ flex: 1 }} />{PLATFORMS.map((p) => <a key={p.name} href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>{p.name} ↗</a>)}</div>
                <div style={{ maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", padding: 11, fontSize: 12.5, lineHeight: 1.6, color: vp ? "var(--text-2)" : "var(--text-3)" }}>{vp || "（本镜还没有视频 Prompt,去「⑤ 逐镜头设计」生成）"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)", flex: "none" }}>成片链接</span>
                  <input defaultValue={sh.video_url || ""} disabled={!canEdit} placeholder="把外部平台生成的视频 URL 粘到这里" onBlur={(e) => saveUrl(sh, e.target.value.trim())} style={{ flex: 1, height: 34, borderRadius: 9, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 11px", color: "var(--text)", outline: "none", fontSize: 12.5 }} />
                  {sh.video_url && <a href={sh.video_url} target="_blank" rel="noreferrer" style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, height: 34, padding: "0 11px", borderRadius: 9, fontSize: 12, color: "var(--accent)", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>查看 ↗</a>}
                </div>
              </div>
            </div>
          ); })}
      </div>
    </StudioShell>
  );
}
