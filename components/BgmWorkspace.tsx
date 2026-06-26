"use client";
import { useState } from "react";
import type { BibleFields } from "@/lib/types";
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov } from "@/components/studio/ui";

export default function BgmWorkspace({ projectId, projectName, canEdit, bible }: {
  projectId: string; projectName: string; canEdit: boolean; bible: BibleFields;
}) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function gen() {
    setBusy(true);
    try {
      const sys = "你是影视配乐与 Suno 提示词专家。基于项目信息给出适合该 AI 漫剧短剧的 BGM 方案,用于到 Suno 生成纯音乐 BGM。给:中文说明(整体情绪/风格、主要乐器、速度 BPM、随剧情的结构建议:铺垫/高潮/收尾),以及一段可直接粘到 Suno 的英文 Style 提示词。不要 markdown 代码块,直接给纯文本。";
      const usr = `项目《${projectName}》\n题材/时长：${bible.genre || "未填"}\n画风/色调：${bible.style || "未填"}\n世界观：${bible.worldRules || "未填"}\n一句话梗概：${bible.logline || "未填"}`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, model: "deepseek-flash", messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || "AI 失败");
      setBrief(data.content || "");
    } catch (e: any) { setBrief("⚠️ " + (e?.message || "出错")); } finally { setBusy(false); }
  }
  function copy() { navigator.clipboard?.writeText(brief); setCopied(true); setTimeout(() => setCopied(false), 1400); }

  const sysAI = `你是 FG Studio 的配乐 AI,为 AI 漫剧《${projectName}》设计 BGM 与音效:情绪/风格、乐器、BPM、随剧情结构,并能给可粘到 Suno 的英文 Style 提示词。\n画风/基调：${bible.style || ""}；题材：${bible.genre || ""}`;

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="bgm"
      right={<AiPanel embedded projectId={projectId} scope="bgm" title="配乐 AI" badge="FG-BGM" contextNote="读取 故事圣经" system={sysAI}
        quick={["给3种BGM情绪方向", "写一段Suno英文Style", "设计高潮段落配器"]} placeholder="讨论配乐情绪 / 乐器 / 段落……（⌘↵）" />}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 30px 60px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", animation: "blurUp .5s var(--ease) both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>AUDIO</span>
            <span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>sound &amp; score</span>
          </div>
          <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>BGM · 音频 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>一键出 BGM 方案 → Suno</span></h1>
          <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7 }}>基于故事圣经一键生成 BGM 需求（情绪 / 乐器 / BPM / 结构 + 可直接粘到 Suno 的英文 Style），复制后到 Suno 生成纯音乐。</p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {canEdit && <Hov as="button" onClick={gen} base={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", opacity: busy ? 0.6 : 1 }} hover={busy ? undefined : { filter: "brightness(1.08)" }}><Icon d={["M9 18V5l12-2v13", "M9 13a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z", "M21 16a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z"]} size={16} sw={1.7} />{busy ? "生成中…" : "生成 BGM 需求"}</Hov>}
            <button onClick={copy} disabled={!brief} style={{ height: 40, padding: "0 14px", borderRadius: 12, cursor: brief ? "pointer" : "default", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", opacity: brief ? 1 : 0.5 }}>{copied ? "已复制 ✓" : "复制"}</button>
            <a href="https://suno.com/create" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 14px", borderRadius: 12, fontSize: 13, color: "var(--accent)", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)" }}>去 Suno 生成<Icon d={["M7 17 17 7M9 7h8v8"]} size={14} sw={1.7} /></a>
          </div>

          <div style={{ borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="点「生成 BGM 需求」,这里会出现配乐方案 + Suno 英文 Style;也可手动编辑后复制。" style={{ display: "block", width: "100%", minHeight: 420, resize: "vertical", border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, lineHeight: 1.8, padding: "16px 18px", fontFamily: "inherit" }} />
          </div>
        </div>
      </div>
    </StudioShell>
  );
}
