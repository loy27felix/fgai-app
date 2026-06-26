"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BibleFields } from "@/lib/types";
import { saveBible, toggleLock } from "@/app/projects/[id]/bible/actions";
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov, EditArea, EditInput } from "@/components/studio/ui";

export default function BibleWorkspace({
  projectId, projectName, canEdit, bible, locked,
}: { projectId: string; projectName: string; canEdit: boolean; bible: BibleFields; locked: boolean }) {
  const router = useRouter();
  const bRef = useRef<BibleFields>({ ...bible });
  const [lk, setLk] = useState(locked);
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState(bible.logline || "");
  const [busy, setBusy] = useState(false);

  function saveField(field: keyof BibleFields, v: string) { const nb = { ...bRef.current, [field]: v }; bRef.current = nb; if (canEdit) return saveBible(projectId, nb); }
  async function toggle() { const next = !lk; setLk(next); await toggleLock(projectId, next); }

  async function aiDraft() {
    if (!idea.trim()) { alert("先写一句你的灵感/题材。"); return; }
    setBusy(true);
    try {
      const sys = `你是 AI 漫剧策划。基于用户灵感,产出一部竖屏短剧的「故事圣经」。只返回 JSON:{"logline":"一句话梗概","genre":"题材/时长(如:科幻悬疑 · 4集×5分钟)","style":"画风/主色调","worldRules":"世界观底层规则","characters":"主要人物(姓名+性格,每人一行)","taboos":"禁忌/全局负向词"}。中文,不要多余文字、不要markdown。`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, model: "deepseek-flash", jsonOutput: true, messages: [{ role: "system", content: sys }, { role: "user", content: `项目《${projectName}》。灵感：${idea}` }] }) });
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || "AI 失败");
      let p: any = {}; try { p = JSON.parse(data.content || "{}"); } catch { p = {}; }
      const nb: BibleFields = { ...bRef.current };
      (["logline", "genre", "style", "worldRules", "characters", "taboos"] as (keyof BibleFields)[]).forEach((k) => { if (p[k]) (nb as any)[k] = String(p[k]); });
      bRef.current = nb; await saveBible(projectId, nb); setOpen(false); router.refresh();
    } catch (e: any) { alert("破题失败：" + (e?.message || "")); } finally { setBusy(false); }
  }

  const sysAI = `你是 FG Studio 的立项策划 AI,帮用户为竖屏 AI 漫剧《${projectName}》破题:确定核心冲突、题材、画风/主色调、世界观规则、主要人物性格与禁忌。讨论清楚后,提醒用户点左上「AI 破题成稿」一键写入故事圣经。回答简洁、可执行。`;
  const FIELDS: { k: keyof BibleFields; label: string; ph: string; area: boolean; minH?: number }[] = [
    { k: "logline", label: "一句话梗概", ph: "用一句话讲清这部短剧。", area: true, minH: 64 },
    { k: "genre", label: "题材 / 时长", ph: "如：科幻悬疑 · 4集×5分钟", area: false },
    { k: "style", label: "画风 / 主色调", ph: "如：暗黑童话、冷调低照度、单点光源、电影感。", area: true, minH: 88 },
    { k: "worldRules", label: "世界观底层规则", ph: "这个世界运行的底层设定与规则。", area: true, minH: 100 },
    { k: "characters", label: "主要人物", ph: "姓名 + 性格,每人一行。性格会带入后续所有 AI 对话记忆。", area: true, minH: 120 },
    { k: "taboos", label: "禁忌 / 全局负向词", ph: "全局禁止出现的元素 / 负向词。", area: true, minH: 80 },
  ];

  const card = (f: typeof FIELDS[number]) => (
    <div key={f.k} style={{ borderRadius: 18, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", borderBottom: "1px solid var(--stroke)" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{f.label}</span>
        {f.k === "characters" && <span style={{ fontSize: 11, color: "var(--text-3)" }}>· 性格带入后续 AI 记忆</span>}
        <div style={{ flex: 1 }} />
        {(bRef.current[f.k]) ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--accent)", padding: "3px 9px", borderRadius: 7, background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />已填</span> : <span style={{ fontSize: 11, color: "var(--text-3)" }}>待填</span>}
      </div>
      <div style={{ padding: "12px 14px" }}>
        {f.area
          ? <EditArea key={f.k + ((bible[f.k] as string) || "").length} value={(bible[f.k] as string) || ""} disabled={!canEdit} minH={f.minH || 90} placeholder={f.ph} onSave={(v) => saveField(f.k, v)} style={{ fontSize: 14, lineHeight: 1.75 }} />
          : <EditInput key={f.k + ((bible[f.k] as string) || "").length} value={(bible[f.k] as string) || ""} disabled={!canEdit} placeholder={f.ph} onSave={(v) => saveField(f.k, v)} style={{ fontSize: 14, padding: "9px 11px", border: "1px solid var(--stroke)", background: "var(--bg-2)" }} />}
      </div>
    </div>
  );

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="bible" saved="自动保存"
      right={<AiPanel embedded projectId={projectId} scope="bible" title="立项策划 AI" badge="FG-Bible" contextNote="立项阶段 · 帮你破题" system={sysAI}
        quick={["帮我把这个点子破题成短剧", "给3个画风方向", "设计主角性格与对手"]} placeholder="描述你想要的故事风格、人物或世界观……（⌘↵）" />}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 30px 70px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", animation: "blurUp .5s var(--ease) both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.6px" }}>故事圣经 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>风格 · 人设 · 世界观</span></h1>
            <span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>story bible</span>
            <div style={{ flex: 1 }} />
            {canEdit && <>
              <Hov as="button" onClick={toggle} base={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 13px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, color: lk ? "var(--accent-ink)" : "var(--text-2)", background: lk ? "var(--accent)" : "var(--panel)", border: "1px solid var(--stroke)" }} hover={{ filter: "brightness(1.05)" }}><Icon d={lk ? ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"] : ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 7-2.6"]} size={15} sw={1.7} />{lk ? "风格已锁定" : "锁定风格"}</Hov>
              <Hov as="button" onClick={() => setOpen(true)} base={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 6px 0 15px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)" }} hover={{ filter: "brightness(1.08)" }}>AI 破题成稿<span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={14} sw={1.9} /></span></Hov>
            </>}
          </div>
          <p style={{ margin: "0 0 22px", fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7 }}>这里定下的基调、人物性格与世界观,会作为「记忆」带入后续剧本、资产、分镜、逐镜头的所有 AI 对话。</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {card(FIELDS[0])}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{card(FIELDS[1])}{card(FIELDS[2])}</div>
            {card(FIELDS[3])}
            {card(FIELDS[4])}
            {card(FIELDS[5])}
          </div>
        </div>
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,16,.6)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: "var(--panel-solid)", border: "1px solid var(--stroke-2)", borderRadius: 20, padding: 22, boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>AI 破题成稿</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 14 }}>写一句你的灵感/题材,AI 一次性产出梗概、题材、画风、世界观、人物、禁忌,写入故事圣经(可再手改)。</div>
            <textarea autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="如：近未来深空观测站,唯一值守者收到一束未编码信号……" rows={4} style={{ width: "100%", borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "11px 13px", color: "var(--text)", outline: "none", fontSize: 14, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)} style={{ height: 40, padding: "0 16px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>取消</button>
              <button onClick={aiDraft} disabled={busy} style={{ height: 40, padding: "0 18px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy ? 0.6 : 1 }}>{busy ? "破题中…" : "生成并写入"}</button>
            </div>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
