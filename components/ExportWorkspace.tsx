"use client";
import { useState } from "react";
import Link from "next/link";
import type { Episode, Scene } from "@/lib/types";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publicUrl = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);
function fmt(sec: number) { const m = Math.floor(sec / 60); const s = sec % 60; return m ? `${m}分${s}秒` : `${s}秒`; }

export default function ExportWorkspace({ projectId, projectName, episodes, scenes, shots }: {
  projectId: string; projectName: string; episodes: Episode[]; scenes: Scene[]; shots: any[];
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function epRows(ep: Episode) {
    const sc = scenes.filter((s) => s.episode_id === ep.id).sort((a, b) => a.idx - b.idx);
    const rows: { scene: Scene; shot: any }[] = [];
    for (const scene of sc) {
      const ss = shots.filter((x) => x.scene_id === scene.id).sort((a, b) => (a.ord || 0) - (b.ord || 0));
      for (const shot of ss) rows.push({ scene, shot });
    }
    return rows;
  }
  const allShots = shots;
  const totalDur = allShots.reduce((a, s) => a + (s.duration_s || 0), 0);
  const readyAll = allShots.filter((s) => s.video_url).length;

  function flash(id: string) { setCopied(id); setTimeout(() => setCopied(null), 1500); }
  function copy(text: string, id: string) { navigator.clipboard?.writeText(text); flash(id); }
  function download(name: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const u = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
  }

  function buildManifest() {
    const lines: string[] = [`《${projectName}》成片拼接清单`, ""];
    for (const ep of episodes) {
      const rows = epRows(ep);
      const dur = rows.reduce((a, r) => a + (r.shot.duration_s || 0), 0);
      const ready = rows.filter((r) => r.shot.video_url).length;
      lines.push(`==== ${ep.title || "第" + ep.idx + "集"}　(${rows.length} 镜 / ${fmt(dur)} / 就绪 ${ready}/${rows.length}) ====`);
      rows.forEach((r, i) => {
        lines.push(`${String(i + 1).padStart(2, "0")}. [${ep.idx}-${r.scene.idx} ${r.shot.no || ""}] ${r.shot.duration_s || 0}s  ${r.shot.video_url || "（缺视频）"}`);
      });
      lines.push("");
    }
    lines.push(`合计：${allShots.length} 镜 / ${fmt(totalDur)} / 已回填视频 ${readyAll}/${allShots.length}`);
    lines.push("BGM：见项目「⑦ BGM」页生成并到 Suno 制作。");
    return lines.join("\n");
  }

  function buildFfmpeg(ep: Episode) {
    const rows = epRows(ep).filter((r) => r.shot.video_url);
    const list = rows.map((r, i) => `file 'clip${String(i + 1).padStart(2, "0")}.mp4'`).join("\n");
    const map = rows.map((r, i) => `clip${String(i + 1).padStart(2, "0")}.mp4  =  [${ep.idx}-${r.scene.idx} ${r.shot.no || ""}]  ${r.shot.video_url}`).join("\n");
    const name = `第${ep.idx}集`;
    return [
      `# ${name} 拼接（先把下面对应的视频按 clipNN.mp4 下载到同一文件夹）`,
      `# 对应关系：`,
      map || "# （本集还没有任何回填视频）",
      ``,
      `# 1) 新建 list.txt，内容：`,
      list || "# （无）",
      ``,
      `# 2) 顺序拼接：`,
      `ffmpeg -f concat -safe 0 -i list.txt -c copy ${name}.mp4`,
      ``,
      `# 3) 叠加 BGM（bgm.mp3 为 Suno 导出的配乐）：`,
      `ffmpeg -i ${name}.mp4 -i bgm.mp3 -map 0:v -map 1:a -c:v copy -shortest ${name}_带BGM.mp4`,
    ].join("\n");
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-disp text-[26px] font-semibold tracking-tight">拼接 & 导出</h2>
          <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-[#616161]">汇总每集每镜的回填视频，生成成片拼接清单与 ffmpeg 拼接命令；缺视频的镜头会标红，回 ⑥ 补齐。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-full bg-[#34d399] px-4 py-1.5 text-[12.5px] font-medium text-[#0a2018]" onClick={() => copy(buildManifest(), "manifest")}>{copied === "manifest" ? "已复制 ✓" : "复制总清单"}</button>
          <button className="pill pill-sm pill-ghost" onClick={() => download(`${projectName}-拼接清单.txt`, buildManifest())}>下载清单</button>
          <Link href={`/projects/${projectId}/bgm`} className="pill pill-sm pill-ghost">去 ⑦ BGM →</Link>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["集数", String(episodes.length)], ["镜头总数", String(allShots.length)], ["视频就绪", `${readyAll}/${allShots.length}`], ["预估总时长", fmt(totalDur)]].map(([k, v]) => (
          <div key={k} className="lglass rounded-[18px] p-4"><div className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">{k}</div><div className="mt-1 font-disp text-[22px] font-semibold">{v}</div></div>
        ))}
      </div>

      {episodes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-hairline py-16 text-center text-[14px] text-muted">还没有内容，先从 ② 剧本建集 / 场。</div>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {episodes.map((ep) => {
            const rows = epRows(ep);
            const dur = rows.reduce((a, r) => a + (r.shot.duration_s || 0), 0);
            const ready = rows.filter((r) => r.shot.video_url).length;
            return (
              <div key={ep.id} className="card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h3 className="font-disp text-[17px] font-semibold">{ep.title || `第${ep.idx}集`}</h3>
                  <span className="chip">{rows.length} 镜</span>
                  <span className="chip">{fmt(dur)}</span>
                  <span className={`chip ${ready === rows.length && rows.length ? "chip-green" : "chip-coral"}`}>就绪 {ready}/{rows.length}</span>
                  <button className="ml-auto rounded-md border border-hairline px-2.5 py-1 text-[12px] hover:border-green hover:text-green" onClick={() => copy(buildFfmpeg(ep), `ff-${ep.id}`)}>{copied === `ff-${ep.id}` ? "已复制 ✓" : "⧉ 复制本集 ffmpeg 拼接"}</button>
                </div>
                {rows.length === 0 ? (
                  <p className="text-[13px] text-muted">本集还没有镜头。</p>
                ) : (
                  <div className="flex flex-col divide-y divide-[#f2f2f2]">
                    {rows.map((r, i) => (
                      <div key={r.shot.id} className="flex items-center gap-3 py-2">
                        <span className="w-7 flex-none text-center font-mono text-[12px] text-muted">{i + 1}</span>
                        {publicUrl(r.shot.keyframe_path) ? <img src={publicUrl(r.shot.keyframe_path)!} alt="" className="h-10 w-14 flex-none rounded-md border border-hairline object-cover" /> : <div className="h-10 w-14 flex-none rounded-md border border-dashed border-hairline" />}
                        <span className="w-24 flex-none font-mono text-[12px]">{ep.idx}-{r.scene.idx} {r.shot.no || ""}</span>
                        <span className="w-12 flex-none font-mono text-[12px] text-muted">{r.shot.duration_s || 0}s</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{(r.shot.roles || []).join("、")}</span>
                        {r.shot.video_url ? (
                          <a href={r.shot.video_url} target="_blank" rel="noreferrer" className="flex-none rounded-pill bg-green-pale px-2.5 py-1 text-[11.5px] font-medium text-green">✓ 视频 ↗</a>
                        ) : (
                          <Link href={`/projects/${projectId}/video?scene=${r.scene.id}`} className="flex-none rounded-pill bg-[#fff1ee] px-2.5 py-1 text-[11.5px] font-medium text-coral">缺视频 · 去⑥</Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
