"use client";
import { useState } from "react";
import type { BibleFields } from "@/lib/types";

export default function BgmWorkspace({ projectId, canEdit, bible, projectName }: {
  projectId: string; canEdit: boolean; bible: BibleFields; projectName: string;
}) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function gen() {
    setBusy(true);
    try {
      const sys = "你是影视配乐与 Suno 提示词专家。基于项目信息给出适合该 AI 漫剧短剧的 BGM 方案，用于到 Suno 生成纯音乐 BGM。给：中文说明（整体情绪/风格、主要乐器、速度 BPM、随剧情的结构建议：铺垫/高潮/收尾），以及一段可直接粘到 Suno 的英文 Style 提示词。不要 markdown 代码块，直接给纯文本。";
      const usr = `项目《${projectName}》\n题材/时长：${bible.genre || "未填"}\n画风/色调：${bible.style || "未填"}\n世界观：${bible.worldRules || "未填"}\n一句话梗概：${bible.logline || "未填"}`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, mode: "flash", messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 失败");
      setBrief(data.content || "");
    } catch (e: any) { setBrief("⚠️ " + (e?.message || "出错")); }
    finally { setBusy(false); }
  }
  function copy() { navigator.clipboard?.writeText(brief); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  const act = "rounded-full border border-black/12 px-4 py-2 text-[13px] transition hover:border-black/35 disabled:opacity-50 dark:border-white/15 dark:hover:border-white/40";

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <h2 className="font-disp text-[22px] font-semibold tracking-tight">BGM / 音频</h2>
      <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-black/55 dark:text-white/50">基于故事圣经一键生成 BGM 需求（情绪 / 乐器 / BPM / 结构 + 可直接粘到 Suno 的英文 Style），复制后到 Suno 生成纯音乐。</p>
      <div className="lglass mt-5 rounded-[20px] p-5">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <button className="rounded-full bg-[#34d399] px-4 py-2 text-[13px] font-medium text-[#0a2018] active:scale-[.98] disabled:opacity-50" disabled={busy} onClick={gen}>{busy ? "生成中…" : "生成 BGM 需求"}</button>}
          <button className={act} disabled={!brief} onClick={copy}>{copied ? "已复制" : "复制"}</button>
          <a href="https://suno.com" target="_blank" rel="noreferrer" className={act}>去 Suno 生成 ↗</a>
        </div>
        <textarea className="mt-4 min-h-[360px] w-full resize-y rounded-xl border border-hairline bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="点「生成 BGM 需求」，这里会出现配乐方案 + Suno 英文 Style 提示；也可手动编辑后复制。" />
      </div>
    </div>
  );
}
