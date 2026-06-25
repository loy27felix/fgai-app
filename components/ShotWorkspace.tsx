"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields, Episode, Scene, LockRef } from "@/lib/types";
import { updateShot } from "@/app/projects/[id]/board/actions";
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

export default function ShotWorkspace({
  projectId, canEdit, bible, episodes, scenes, selectedSceneId, shots, subshots, selectedShotId, lockRefs,
}: {
  projectId: string; canEdit: boolean; bible: BibleFields;
  episodes: Episode[]; scenes: Scene[]; selectedSceneId: string | null;
  shots: any[]; subshots: any[]; selectedShotId: string | null; lockRefs: LockRef[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const selScene = scenes.find((s) => s.id === selectedSceneId) || null;
  const curEp = episodes.find((e) => e.id === (selScene?.episode_id || episodes[0]?.id)) || null;
  const epScenes = scenes.filter((s) => s.episode_id === curEp?.id);
  const shot = shots.find((s) => s.id === selectedShotId) || null;
  const subs = subshots.filter((x) => x.shot_id === selectedShotId);

  const [vp, setVp] = useState<string>(shot?.video_prompt?.text || "");
  const [note, setNote] = useState<string>(shot?.variable_data?.note || "");
  const [busy, setBusy] = useState("");
  const [kbusy, setKbusy] = useState(false);
  const [sbusy, setSbusy] = useState(false);
  const [kfModel, setKfModel] = useState("nano-banana-pro");
  const [kfRatio, setKfRatio] = useState("9:16");
  const [vpFormat, setVpFormat] = useState<"简洁" | "详细">("简洁");

  function goScene(id: string) { router.push(`/projects/${projectId}/shots?scene=${id}`); }
  function goShot(id: string) { router.push(`/projects/${projectId}/shots?scene=${selectedSceneId}&shot=${id}`); }

  async function genVP() {
    if (!shot) return;
    setBusy("AI 生成视频 Prompt 中…");
    try {
      const subTxt = subs.map((s) => `［${s.size || ""}/${s.movement || ""}］${s.composition || ""} ${s.action || ""}`).join("\n");
      const mem = `画风=${bible.style || "未填"}；人物=${bible.characters || "未填"}；世界观=${bible.worldRules || "未填"}；禁忌=${bible.taboos || "无"}。`;
      let sys: string; let usr: string;
      if (vpFormat === "详细") {
        sys = [
          "你是顶级 AI 漫剧/短剧的视频导演与提示词专家。严格按【模板】输出中文视频 Prompt：分镜按镜头时长切分时间码、覆盖整镜时长；画面禁止字幕/水印/logo。",
          `项目记忆：${mem}`,
          "【模板】",
          "【基础设定】逐个角色（身形/服装/材质/特征）；场景（年代/环境/光线/道具）；声音（是否配乐，默认仅同期声）。",
          "【氛围与画质】风格核心：…；视觉基调：…（摄影机/镜头/动态模糊等）；色彩与影调：…。",
          "【画面内容】分镜一：00:00-00:0X 景别：… 构图：… 运镜手法：… 画面内容：…（继续分镜二、三…直到覆盖整镜时长）。",
        ].join("\n");
        usr = `为镜头 ${shot.no}（总时长约 ${shot.duration_s || 4} 秒，出场：${(shot.roles || []).join("、") || "无"}）按上面模板生成视频 Prompt。子分镜参考：\n${subTxt || "（无）"}\n时间码从 00:00 起按节奏切到约 ${shot.duration_s || 4} 秒。只输出模板正文。`;
      } else {
        sys = `${mem}你是 AI 漫剧的视频提示词专家。`;
        usr = [
          `为镜头 ${shot.no}（时长约${shot.duration_s || 4}s，方式：${shot.video_method || ""}，出场：${(shot.roles || []).join("、")}）生成一段视频生成 Prompt。`,
          `子分镜：\n${subTxt || "（无）"}`,
          "要求：体现景别/运镜/切镜与构图；保持人物一致性参考；画面禁止字幕/水印/logo，无 BGM，仅环境音与人声。只输出 Prompt 正文。",
        ].join("\n");
      }
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, mode: vpFormat === "详细" ? "pro" : "flash", thinking: false, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 失败");
      setVp(data.content);
      await updateShot(projectId, shot.id, { video_prompt: { text: data.content } });
      setBusy("已生成并保存 ✓"); router.refresh();
    } catch (e: any) { setBusy("⚠️ " + (e?.message || "出错")); }
    finally { setTimeout(() => setBusy(""), 3000); }
  }
  async function saveVP() { if (!shot) return; await updateShot(projectId, shot.id, { video_prompt: { text: vp } }); setBusy("已保存 ✓"); setTimeout(() => setBusy(""), 2000); }
  async function saveNote() { if (!shot) return; await updateShot(projectId, shot.id, { variable_data: { ...(shot.variable_data || {}), note } }); }

  function lockFor(roles: string[]) {
    return lockRefs.find((r) => (roles || []).some((role) => role && (role === r.char_name || role.includes(r.char_name) || r.char_name.includes(role))));
  }
  async function genKeyframe() {
    if (!shot) return;
    setKbusy(true);
    try {
      const base = vp.trim() || subs.map((s) => `${s.size || ""} ${s.composition || ""} ${s.action || ""}`.trim()).filter(Boolean).join("；");
      const prompt = [
        "AI 漫剧关键帧 / 首帧，单张成片质感画面，竖构图。",
        `整体画风：${bible.style || "未定"}。`,
        `出场角色（保持一致性）：${(shot.roles || []).join("、") || "（无）"}。`,
        `镜头 ${shot.no || ""}：${base || "见本场分镜"}。`,
        "画面禁止字幕/水印/logo。",
      ].join("\n");
      const payload: any = { projectId, shotId: shot.id, shotField: "keyframe_path", model: kfModel, size: sizeFor(kfModel, kfRatio), prompt };
      const ref = lockFor(shot.roles || []);
      if (ref) { const rb = await urlToB64(ref.url); if (rb) { payload.refImage = rb.b64; payload.refType = rb.type; } }
      const { data: d, error } = await supabase.functions.invoke("gen-image", { body: payload });
      if (error || !d?.ok) { alert("生成关键帧失败：" + ((d && d.error) || error?.message || "")); return; }
      router.refresh();
    } catch (e: any) { alert("网络错误：" + (e?.message || "")); }
    finally { setKbusy(false); }
  }

  async function genSpaceRef() {
    if (!shot) return;
    setSbusy(true);
    try {
      const prompt = [
        "俯视示意：角色空间位置关系参考图（走位示意图），简洁示意风、标出相对位置与朝向。",
        `场景画风参考：${bible.style || "未定"}。`,
        `走位 / 比例 / 动线：${note.trim() || "未填"}。`,
        "画面禁止字幕/水印。",
      ].join("\n");
      const { data: d, error } = await supabase.functions.invoke("gen-image", { body: { projectId, type: "场景", model: kfModel, size: sizeFor(kfModel, "1:1"), prompt } });
      if (error || !d?.ok) { alert("生成空间参考图失败：" + ((d && d.error) || error?.message || "")); return; }
      alert("已生成并存入「资产库 · 场景」。");
    } catch (e: any) { alert("网络错误：" + (e?.message || "")); }
    finally { setSbusy(false); }
  }

  const checks = [
    ["接口处切镜（与上一镜换机位）", subs.length > 0],
    ["相邻子分镜避免相同景别硬切", new Set(subs.map((s) => s.size)).size === subs.length || subs.length < 2],
    ["机位转角 ≥ 30°（切镜时）", subs.some((s) => /切镜|转/.test(s.movement || "")) || true],
    ["全程禁字幕 / 水印 / BGM", /禁止字幕|无\s*BGM/.test(vp)],
    ["传入可变动数据（走位 / 比例参考）", !!note.trim()],
  ] as [string, boolean][];

  const railItem = (active: boolean) => ["w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition", active ? "bg-[#34d399]/14 text-[#1d9e75] ring-1 ring-[#34d399]/30 dark:text-[#5fe3c0]" : "text-black/65 hover:bg-black/5 dark:text-white/65 dark:hover:bg-white/6"].join(" ");
  const sel = "rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-[12px]";
  const act = "rounded-full border border-black/12 px-3.5 py-1.5 text-[12.5px] transition hover:border-black/35 dark:border-white/15 dark:hover:border-white/40";

  return (
    <div className="mx-auto flex max-w-[1560px] flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-108px)] lg:flex-row">
      {/* 左：场 / 镜头 */}
      <aside className="lglass flex w-full flex-none flex-col overflow-hidden rounded-[20px] lg:w-[224px]">
        <div className="border-b border-black/8 px-4 py-3 dark:border-white/8"><div className="font-disp text-[14px] font-semibold">场 / 镜头</div></div>
        <div className="flex-1 space-y-1 overflow-auto p-3">
          <div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">场</div>
          {epScenes.map((s) => (<button key={s.id} onClick={() => goScene(s.id)} className={railItem(s.id === selectedSceneId)}>{curEp?.idx}-{s.idx} {s.title || "（未命名）"}</button>))}
          {shots.length > 0 && <><div className="px-1 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">镜头</div>
            <div className="flex flex-wrap gap-1.5">{shots.map((s) => (<button key={s.id} onClick={() => goShot(s.id)} className={["rounded-lg px-2.5 py-1.5 font-mono text-[12px] transition", s.id === selectedShotId ? "bg-[#34d399] text-[#0a2018]" : "bg-black/5 text-black/65 hover:bg-black/10 dark:bg-white/6 dark:text-white/65"].join(" ")}>{s.no}</button>))}</div></>}
        </div>
      </aside>

      {/* 中：关键帧 + 视频 Prompt */}
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto">
        <h2 className="font-disp text-[20px] font-semibold tracking-tight">逐镜头设计 {shot && <span className="chip ml-1">镜 {shot.no}</span>}</h2>
        {!shot ? (
          <div className="grid flex-1 place-items-center rounded-[20px] border border-dashed border-black/12 text-center text-[14px] text-black/45 dark:border-white/12 dark:text-white/45">这场还没有镜头，先去「导演分镜表」拆分镜。</div>
        ) : (
          <>
            <div className="lglass rounded-[20px] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-disp text-[15px] font-semibold">关键帧 / 首帧</h3>
                {lockFor(shot.roles || []) && <span className="chip chip-green">锁脸 {lockFor(shot.roles || [])!.char_name}</span>}
                {canEdit && <select className={`${sel} ml-auto`} value={kfModel} onChange={(e) => setKfModel(e.target.value)}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
                {canEdit && <select className={sel} value={kfRatio} onChange={(e) => setKfRatio(e.target.value)}>{RATIOS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>}
                {canEdit && <button className="rounded-full bg-[#34d399] px-4 py-1.5 text-[12.5px] font-medium text-[#0a2018] disabled:opacity-50" disabled={kbusy} onClick={genKeyframe}>{kbusy ? "生成中…" : shot.keyframe_path ? "重生成" : "生成关键帧"}</button>}
              </div>
              {shot.keyframe_path ? <img src={publicUrl(shot.keyframe_path)!} alt="关键帧" className="max-h-[360px] w-full rounded-xl border border-hairline object-contain" /> : <div className="grid h-44 place-items-center rounded-xl border border-dashed border-hairline text-center text-[13px] text-muted">还没有关键帧 · 点右上「生成关键帧」</div>}
            </div>
            <div className="lglass rounded-[20px] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="font-disp text-[15px] font-semibold">视频 Prompt</h3>
                {busy && <span className="text-[12px] text-[#1d9e75] dark:text-[#5fe3c0]">{busy}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {canEdit && <select value={vpFormat} onChange={(e) => setVpFormat(e.target.value as "简洁" | "详细")} className={sel} title="输出格式"><option value="简洁">简洁</option><option value="详细">详细分镜格式</option></select>}
                  {canEdit && <button className="rounded-full bg-[#34d399] px-4 py-1.5 text-[12.5px] font-medium text-[#0a2018]" onClick={genVP}>AI 生成</button>}
                  {canEdit && <button className={act} onClick={saveVP}>保存</button>}
                  <button className={act} onClick={() => { navigator.clipboard?.writeText(vp); }}>复制</button>
                </div>
              </div>
              <textarea className="min-h-[200px] w-full resize-y rounded-xl border border-hairline bg-transparent p-3 font-mono text-[12.5px] leading-[1.7] outline-none" disabled={!canEdit} value={vp} onChange={(e) => setVp(e.target.value)} placeholder="点「AI 生成」从本镜头子分镜+故事圣经生成视频 Prompt（可选详细分镜格式带时间码）…" />
            </div>
          </>
        )}
      </main>

      {/* 右：走位 + 拼接检查 */}
      {shot && (
        <aside className="flex w-full flex-none flex-col gap-3 lg:w-[330px]">
          <div className="lglass rounded-[20px] p-4">
            <h3 className="mb-1 font-disp text-[15px] font-semibold">走位 / 比例 / 动线</h3>
            <p className="mb-2 text-[12px] text-muted">写清站位、身高比例、动线（喂给生成、解决拼接的可变动数据）。</p>
            <textarea className="min-h-[120px] w-full resize-y rounded-xl border border-hairline bg-transparent p-3 text-[13px] outline-none" disabled={!canEdit} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder="例：狼 185cm 居中略前，母羊 172cm 屋内左，小羊 168cm 门后右下…" />
            {canEdit && <button className={`${act} mt-2`} disabled={sbusy} onClick={genSpaceRef}>{sbusy ? "生成中…" : "生成空间参考图"}</button>}
          </div>
          <div className="lglass rounded-[20px] p-4">
            <h3 className="mb-2 font-disp text-[15px] font-semibold">拼接检查清单</h3>
            <div className="flex flex-col gap-1.5">
              {checks.map(([t, ok]) => (
                <div key={t} className={`flex items-center gap-2.5 text-[13px] ${ok ? "" : "text-muted"}`}>
                  <span className={`grid h-4 w-4 flex-none place-items-center rounded border text-[10px] ${ok ? "border-[#34d399]/50 bg-[#34d399]/15 text-[#1d9e75] dark:text-[#5fe3c0]" : "border-hairline"}`}>{ok ? "✓" : ""}</span>{t}
                </div>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
