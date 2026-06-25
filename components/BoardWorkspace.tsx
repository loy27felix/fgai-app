"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields, Episode, Scene, LockRef } from "@/lib/types";
import { addShot, updateShot, delShot, addSubshot, updateSubshot, delSubshot, insertShots } from "@/app/projects/[id]/board/actions";
import { createClient } from "@/lib/supabase/client";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publicUrl = (p?: string | null) => (p ? `${SB_URL}/storage/v1/object/public/project-assets/${p}` : null);

async function urlToB64(url: string): Promise<{ b64: string; type: string } | null> {
  try {
    const r = await fetch(url); const blob = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ b64: String(fr.result).split(",")[1] || "", type: blob.type || "image/png" }); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

const SPLIT_RULES =
  "把下面这场剧本拆成导演分镜。规则：每个镜头≤15秒；一个8-12秒镜头通常含3-4句台词且会切镜头，所以每个镜头要拆成多个子分镜（切镜）。" +
  "景别从【远景/全景/中景/近景/特写】里选；运镜如【固定/缓推/横移/切镜转35°】；相邻子分镜避免相同景别硬切。" +
  "video_method 取【强把控分镜图】或【故事版】。roles 是该镜头出场角色名数组。" +
  '只输出合法 JSON：{"shots":[{"no":"S1","duration_s":4,"video_method":"强把控分镜图","roles":["角色"],"subshots":[{"size":"中景","movement":"固定","composition":"主体与构图","action":"动作或台词"}]}]}';

export default function BoardWorkspace({
  projectId, canEdit, bible, episodes, scenes, selectedSceneId, shots, subshots, scriptBody, lockRefs,
}: {
  projectId: string; canEdit: boolean; bible: BibleFields;
  episodes: Episode[]; scenes: Scene[]; selectedSceneId: string | null;
  shots: any[]; subshots: any[]; scriptBody: string; lockRefs: LockRef[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState("");
  const [genId, setGenId] = useState<string | null>(null);
  const [frameModel, setFrameModel] = useState("nano-banana-pro");
  const [frameRatio, setFrameRatio] = useState("9:16");

  const selScene = scenes.find((s) => s.id === selectedSceneId) || null;
  const curEpId = selScene?.episode_id || episodes[0]?.id || null;
  const curEp = episodes.find((e) => e.id === curEpId) || null;
  const epScenes = scenes.filter((s) => s.episode_id === curEpId);
  const subsOf = (shotId: string) => subshots.filter((x) => x.shot_id === shotId);

  function go(sceneId: string) { router.push(`/projects/${projectId}/board?scene=${sceneId}`); }
  async function run<T>(fn: () => Promise<T>) { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } }

  function framePrompt(sh: any) {
    const subs = subsOf(sh.id);
    const desc = subs.map((s) => `${s.size || ""} ${s.movement || ""} ${s.composition || ""} ${s.action || ""}`.trim()).filter(Boolean).join("；");
    return [
      "导演分镜参考图：单格画面、简练线稿/草图质感，构图清晰。",
      `整体画风参考：${bible.style || "未定"}。`,
      `出场角色：${(sh.roles || []).join("、") || "（无）"}。`,
      `镜头 ${sh.no || ""}（${sh.video_method || ""}）。`,
      `画面内容：${desc || "见本场剧本"}。`,
      "画面禁止字幕/水印/logo。",
    ].join("\n");
  }

  function lockFor(roles: string[]) {
    return lockRefs.find((r) => (roles || []).some((role) => role && (role === r.char_name || role.includes(r.char_name) || r.char_name.includes(role))));
  }
  async function genFrame(sh: any) {
    setGenId(sh.id);
    try {
      const payload: any = { projectId, shotId: sh.id, shotField: "frame_path", model: frameModel, size: sizeFor(frameModel, frameRatio), prompt: framePrompt(sh) };
      const ref = lockFor(sh.roles || []);
      if (ref) { const rb = await urlToB64(ref.url); if (rb) { payload.refImage = rb.b64; payload.refType = rb.type; } }
      const { data: d, error } = await supabase.functions.invoke("gen-image", { body: payload });
      if (error || !d?.ok) { alert("生成分镜图失败：" + ((d && d.error) || error?.message || "")); return false; }
      return true;
    } catch (e: any) { alert("网络错误：" + (e?.message || "")); return false; }
    finally { setGenId(null); }
  }
  async function genFrameAndRefresh(sh: any) { const ok = await genFrame(sh); if (ok) router.refresh(); }

  async function genAllFrames() {
    if (!shots.length) return;
    if (!confirm(`为本场 ${shots.length} 个镜头各生成一张分镜图？（按次计费）`)) return;
    for (const sh of shots) { await genFrame(sh); }
    router.refresh();
  }

  async function aiSplit() {
    if (!selectedSceneId) return;
    if (!scriptBody.trim()) { alert("这场还没有剧本正文，先去「剧本工作台」写或生成本场剧本。"); return; }
    if (shots.length && !confirm("本场已有镜头，AI 拆分镜会在末尾追加新镜头，继续？")) return;
    setBusy(true); setAi("AI 拆分镜中…");
    try {
      const sys = [
        `项目故事圣经：画风=${bible.style || "未填"}；人物=${bible.characters || "未填"}；世界观=${bible.worldRules || "未填"}。`,
        SPLIT_RULES,
      ].join("\n");
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode: "pro", thinking: false, jsonOutput: true, messages: [{ role: "system", content: sys }, { role: "user", content: `场号 ${curEp?.idx}-${selScene?.idx}\n剧本：\n${scriptBody}` }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 失败");
      let parsed: any; try { parsed = JSON.parse(data.content); } catch { throw new Error("AI 返回不是合法 JSON，换 pro 模型或重试"); }
      const list = parsed?.shots || [];
      if (!list.length) throw new Error("没拆出镜头");
      const r = await insertShots(projectId, selectedSceneId, list);
      setAi(r?.ok ? `已生成 ${r.count} 个镜头 ✓` : `失败：${r?.error}`);
      router.refresh();
    } catch (e: any) { setAi("⚠️ " + (e?.message || "出错")); }
    finally { setBusy(false); setTimeout(() => setAi(""), 4000); }
  }

  const railItem = (active: boolean) => ["w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition", active ? "bg-[#34d399]/14 text-[#1d9e75] ring-1 ring-[#34d399]/30 dark:text-[#5fe3c0]" : "text-black/65 hover:bg-black/5 dark:text-white/65 dark:hover:bg-white/6"].join(" ");
  const sel = "rounded-lg border border-black/12 bg-transparent px-2 py-1.5 text-[12px] dark:border-white/15";
  const act = "rounded-full border border-black/12 px-3.5 py-1.5 text-[12.5px] transition hover:border-black/35 disabled:opacity-40 dark:border-white/15 dark:hover:border-white/40";

  return (
    <div className="mx-auto flex max-w-[1560px] flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-108px)] lg:flex-row">
      {/* 左：集/场 */}
      <aside className="lglass flex w-full flex-none flex-col overflow-hidden rounded-[20px] lg:w-[230px]">
        <div className="border-b border-black/8 px-4 py-3 dark:border-white/8"><div className="font-disp text-[14px] font-semibold">分集 / 分场</div></div>
        <div className="flex-1 space-y-1 overflow-auto p-3">
          <div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">集</div>
          {episodes.map((e) => (<button key={e.id} onClick={() => { const fs = scenes.find((s) => s.episode_id === e.id); if (fs) go(fs.id); }} className={railItem(e.id === curEpId)}>{e.title || `第${e.idx}集`}</button>))}
          {curEp && <><div className="px-1 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">场</div>
            {epScenes.map((sc) => (<button key={sc.id} onClick={() => go(sc.id)} className={railItem(sc.id === selectedSceneId)}>{curEp.idx}-{sc.idx} {sc.title || "（未命名）"}</button>))}</>}
        </div>
      </aside>

      {/* 中：分镜 */}
      <main className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-disp text-[20px] font-semibold tracking-tight">导演分镜表</h2>
          {ai && <span className="text-[12px] text-[#1d9e75] dark:text-[#5fe3c0]">{ai}</span>}
          {canEdit && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select className={sel} value={frameModel} onChange={(e) => setFrameModel(e.target.value)} title="分镜图模型">{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
              <select className={sel} value={frameRatio} onChange={(e) => setFrameRatio(e.target.value)} title="比例">{RATIOS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
              <button className={act} disabled={busy || !shots.length || !!genId} onClick={genAllFrames}>批量生成分镜图</button>
              <button className="rounded-full bg-[#34d399] px-4 py-1.5 text-[12.5px] font-medium text-[#0a2018] active:scale-[.98] disabled:opacity-40" disabled={busy || !selectedSceneId} onClick={aiSplit}>AI 拆分镜</button>
              <button className={act} disabled={busy || !selectedSceneId} onClick={() => run(() => addShot(projectId, selectedSceneId!))}>＋ 镜头</button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!selectedSceneId ? (
            <div className="grid h-full place-items-center rounded-[20px] border border-dashed border-black/12 text-center text-[14px] text-black/45 dark:border-white/12 dark:text-white/45">先在「剧本工作台」建好集/场。</div>
          ) : shots.length === 0 ? (
            <div className="grid h-full place-items-center rounded-[20px] border border-dashed border-black/12 text-center dark:border-white/12"><div><p className="text-[14px] font-medium">这场还没有分镜</p><p className="mt-1 text-[13px] text-black/45 dark:text-white/45">{canEdit ? "点「AI 拆分镜」自动拆，或「＋ 镜头」手动加。" : "等成员拆分镜。"}</p></div></div>
          ) : (
            <div className="flex flex-col gap-4 pb-2">
              {shots.map((sh) => (
                <div key={sh.id} className="card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input defaultValue={sh.no || ""} disabled={!canEdit} className="w-16 rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-center font-mono text-[13px]" onBlur={(e) => e.target.value !== sh.no && run(() => updateShot(projectId, sh.id, { no: e.target.value }))} />
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">时长<input type="number" min={1} max={15} defaultValue={sh.duration_s ?? 4} disabled={!canEdit} className="w-14 rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-[13px]" onBlur={(e) => Number(e.target.value) !== sh.duration_s && run(() => updateShot(projectId, sh.id, { duration_s: Number(e.target.value) }))} />s</label>
                    <select defaultValue={sh.video_method || "强把控分镜图"} disabled={!canEdit} className="rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-[13px]" onChange={(e) => run(() => updateShot(projectId, sh.id, { video_method: e.target.value }))}><option>强把控分镜图</option><option>故事版</option></select>
                    <input defaultValue={(sh.roles || []).join("、")} disabled={!canEdit} placeholder="出场角色，逗号分隔" className="min-w-[160px] flex-1 rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-[13px]" onBlur={(e) => run(() => updateShot(projectId, sh.id, { roles: e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) }))} />
                    {canEdit && <button className="ml-auto rounded-md px-2 py-1 text-[12px] text-[#d85a30] hover:bg-[#ff7759]/10" onClick={() => { if (confirm("删除该镜头及子分镜？")) run(() => delShot(projectId, sh.id)); }}>删镜头</button>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4">
                    <div className="flex w-[150px] flex-none flex-col gap-2">
                      {sh.frame_path ? <img src={publicUrl(sh.frame_path)!} alt="分镜图" className="h-[100px] w-full rounded-lg border border-hairline object-cover" /> : <div className="grid h-[100px] w-full place-items-center rounded-lg border border-dashed border-hairline text-[11px] text-muted">暂无分镜图</div>}
                      {canEdit && <button className="rounded-full border border-hairline px-2 py-1 text-[11.5px] hover:border-[#34d399] hover:text-[#1d9e75] disabled:opacity-50 dark:hover:text-[#5fe3c0]" disabled={genId === sh.id} onClick={() => genFrameAndRefresh(sh)}>{genId === sh.id ? "生成中…" : sh.frame_path ? "重生成" : "生成分镜图"}</button>}
                      {lockFor(sh.roles || []) && <span className="text-center font-mono text-[10px] text-[#1d9e75] dark:text-[#5fe3c0]">锁脸 {lockFor(sh.roles || [])!.char_name}</span>}
                    </div>
                    <div className="min-w-0 flex-1 overflow-x-auto">
                      <table className="w-full border-collapse text-[12.5px]">
                        <thead><tr className="text-left font-mono text-[10.5px] uppercase tracking-wide text-black/45 dark:text-white/45"><th className="w-20 py-1.5">景别</th><th className="w-24">运镜</th><th>构图 / 主体</th><th>动作 / 台词</th><th className="w-8"></th></tr></thead>
                        <tbody>
                          {subsOf(sh.id).map((ss) => (
                            <tr key={ss.id} className="border-t border-black/6 align-top dark:border-white/8">
                              <td className="py-1.5 pr-2"><input defaultValue={ss.size || ""} disabled={!canEdit} className="w-full rounded border border-hairline bg-transparent px-1.5 py-1" onBlur={(e) => e.target.value !== ss.size && run(() => updateSubshot(projectId, ss.id, { size: e.target.value }))} /></td>
                              <td className="pr-2"><input defaultValue={ss.movement || ""} disabled={!canEdit} className="w-full rounded border border-hairline bg-transparent px-1.5 py-1" onBlur={(e) => e.target.value !== ss.movement && run(() => updateSubshot(projectId, ss.id, { movement: e.target.value }))} /></td>
                              <td className="pr-2"><input defaultValue={ss.composition || ""} disabled={!canEdit} className="w-full rounded border border-hairline bg-transparent px-1.5 py-1" onBlur={(e) => e.target.value !== ss.composition && run(() => updateSubshot(projectId, ss.id, { composition: e.target.value }))} /></td>
                              <td className="pr-2"><input defaultValue={ss.action || ""} disabled={!canEdit} className="w-full rounded border border-hairline bg-transparent px-1.5 py-1" onBlur={(e) => e.target.value !== ss.action && run(() => updateSubshot(projectId, ss.id, { action: e.target.value }))} /></td>
                              <td>{canEdit && <button className="text-[#d85a30]" onClick={() => run(() => delSubshot(projectId, ss.id))}>✕</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {canEdit && <button className="mt-2 rounded-full border border-dashed border-hairline px-3 py-1 text-[12px] text-muted hover:border-[#34d399] hover:text-[#1d9e75] dark:hover:text-[#5fe3c0]" disabled={busy} onClick={() => run(() => addSubshot(projectId, sh.id))}>＋ 子分镜（切镜）</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
