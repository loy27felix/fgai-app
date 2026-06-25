"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Episode, Scene } from "@/lib/types";
import { updateShot } from "@/app/projects/[id]/board/actions";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publicUrl = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);
const PLATFORMS = [
  { name: "Tapnow", url: "https://tapnow.ai" },
  { name: "LiblibTV", url: "https://www.liblib.art" },
  { name: "可灵 Kling", url: "https://app.klingai.com" },
];

export default function VideoWorkspace({ projectId, canEdit, episodes, scenes, selectedSceneId, shots }: {
  projectId: string; canEdit: boolean; episodes: Episode[]; scenes: Scene[]; selectedSceneId: string | null; shots: any[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const selScene = scenes.find((s) => s.id === selectedSceneId) || null;
  const curEpId = selScene?.episode_id || episodes[0]?.id || null;
  const curEp = episodes.find((e) => e.id === curEpId) || null;
  const epScenes = scenes.filter((s) => s.episode_id === curEpId);
  function go(sceneId: string) { router.push(`/projects/${projectId}/video?scene=${sceneId}`); }
  function copy(text: string, id: string) { navigator.clipboard?.writeText(text || ""); setCopied(id); setTimeout(() => setCopied(null), 1500); }
  async function saveUrl(shotId: string, v: string) { await updateShot(projectId, shotId, { video_url: v || null }); router.refresh(); }

  const ready = shots.filter((s) => s.video_url).length;

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      <div>
        <h2 className="font-disp text-[26px] font-semibold tracking-tight">生视频</h2>
        <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-[#616161]">每个镜头备好「关键帧 + 视频 Prompt」，复制后到 Tapnow / Liblib / 可灵 生成视频，再把成片链接回填到这里集中管理。</p>
      </div>

      <div className="mt-5 lglass rounded-[18px] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">集</span>
          {episodes.map((e) => (<button key={e.id} onClick={() => { const fs = scenes.find((s) => s.episode_id === e.id); if (fs) go(fs.id); }} className={pillCls(e.id === curEpId)}>{e.title || `第${e.idx}集`}</button>))}
        </div>
        {curEp && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[#f2f2f2] pt-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">场</span>
            {epScenes.map((s) => (<button key={s.id} onClick={() => go(s.id)} className={pillCls(s.id === selectedSceneId)}>{curEp.idx}-{s.idx} {s.title || ""}</button>))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 lglass rounded-[18px] px-4 py-3">
        <span className="text-[12.5px] text-muted">去外部平台生成视频：</span>
        {PLATFORMS.map((p) => (<a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm pill-ghost">{p.name} ↗</a>))}
        {shots.length > 0 && <span className="ml-auto font-mono text-[11px] text-muted">已回填 {ready}/{shots.length}</span>}
      </div>

      {!selectedSceneId ? (
        <div className="mt-6 rounded-2xl border border-dashed border-hairline py-16 text-center text-[14px] text-muted">先去「剧本 / 分镜」建好集 / 场和镜头。</div>
      ) : shots.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-hairline py-16 text-center text-[14px] text-muted">这场还没有镜头，先去「④ 导演分镜表」拆分镜。</div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {shots.map((sh) => {
            const vp = sh.video_prompt?.text || "";
            const kf = publicUrl(sh.keyframe_path);
            return (
              <div key={sh.id} className="card flex flex-col gap-4 p-4 md:flex-row">
                <div className="flex-none md:w-[170px]">
                  {kf ? <img src={kf} alt="关键帧" className="h-[150px] w-full rounded-xl border border-hairline object-cover" /> : <div className="grid h-[150px] w-full place-items-center rounded-xl border border-dashed border-hairline text-center text-[12px] leading-relaxed text-muted">无关键帧<br />去 ⑤ 生成</div>}
                  <div className="mt-1.5 font-mono text-[11px] text-muted">镜 {sh.no} · {sh.duration_s || 4}s · {sh.video_method || ""}</div>
                  <div className="font-mono text-[11px] text-muted">出场：{(sh.roles || []).join("、") || "—"}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="label mb-0">视频 Prompt</span>
                    <button className="rounded-md border border-hairline px-2 py-0.5 text-[11px] hover:border-green hover:text-green" onClick={() => copy(vp, `vp-${sh.id}`)}>{copied === `vp-${sh.id}` ? "已复制 ✓" : "复制"}</button>
                  </div>
                  <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-transparent p-3 font-mono text-[12px] leading-relaxed text-[#444]">{vp || "（本镜还没有视频 Prompt，去「⑤ 逐镜头」生成）"}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {PLATFORMS.map((p) => (<a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm pill-ghost">去 {p.name} ↗</a>))}
                  </div>
                  <div className="mt-3">
                    <span className="label">回填成片视频链接{sh.video_url && <span className="ml-2 text-green">✓ 已回填</span>}</span>
                    <div className="flex items-center gap-2">
                      <input defaultValue={sh.video_url || ""} disabled={!canEdit} placeholder="把外部平台生成的视频 URL 粘到这里" className="input flex-1" onBlur={(e) => e.target.value !== (sh.video_url || "") && saveUrl(sh.id, e.target.value.trim())} />
                      {sh.video_url && <a href={sh.video_url} target="_blank" rel="noreferrer" className="pill pill-sm pill-ghost">查看 ↗</a>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function pillCls(active: boolean) { return ["rounded-pill px-3 py-1.5 text-[12.5px] font-medium transition", active ? "bg-primary text-white" : "bg-stone text-ink hover:bg-[#e6e3dc]"].join(" "); }
