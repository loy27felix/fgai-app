"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WORKFLOW_SKILLS } from "@/lib/skillData";

type LocalSkill = { id: string; title: string; body: string; updatedAt: string };
type SkillProps = {
  active: string | null;
  draftText?: string;
  onApply: (name: string, content: string) => void;
  onClear: () => void;
};

const LOCAL_SKILLS_KEY = "fg-local-skills-v1";

function readLocalSkills(): LocalSkill[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_SKILLS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.body === "string") : [];
  } catch { return []; }
}

export default function SkillPicker({ active, draftText = "", onApply, onClear }: SkillProps) {
  const sb = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<{ title: string; body: string }[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LocalSkill | null>(null);
  const [draftMode, setDraftMode] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalSkills(readLocalSkills());
    sb.from("custom_presets").select("title,body").order("created_at", { ascending: false }).then(({ data }) => setMine((data as { title: string; body: string }[]) || []));
  }, [open, sb]);

  function persist(next: LocalSkill[]) {
    setLocalSkills(next);
    window.localStorage.setItem(LOCAL_SKILLS_KEY, JSON.stringify(next));
  }

  function beginDraft() {
    const seed = draftText.trim();
    const title = seed.slice(0, 28) || "New skill draft";
    const body = seed
      ? `Goal: ${seed}\n\nMethod:\n1. Understand the task and constraints.\n2. Provide executable steps and checkpoints.\n\nOutput:\n- Keep the context and structure clear.\n- Mark assumptions when uncertain.`
      : "Goal:\n\nMethod:\n\nOutput requirements:";
    setEditing({ id: `local-${Date.now()}`, title, body, updatedAt: new Date().toISOString() });
    setDraftMode(true);
  }

  function saveDraft() {
    if (!editing || !editing.title.trim() || !editing.body.trim()) return;
    const next = [{ ...editing, title: editing.title.trim(), body: editing.body.trim(), updatedAt: new Date().toISOString() }, ...localSkills.filter((item) => item.id !== editing.id)];
    persist(next);
    setEditing(null); setDraftMode(false);
  }

  function removeSkill(id: string) {
    persist(localSkills.filter((item) => item.id !== id));
    if (editing?.id === id) { setEditing(null); setDraftMode(false); }
  }

  async function applyFile(s: { id: string; title: string; file: string }) {
    setLoadingId(s.id);
    try { const r = await fetch(`/skills/${s.file}`); const t = await r.text(); onApply(s.title, t); setOpen(false); }
    catch { alert("读取技能失败"); } finally { setLoadingId(null); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition ${active ? "border-[#34d399]/40 bg-[#34d399]/12 text-[#5fe3c0]" : "border-white/12 text-white/70 hover:bg-white/8"}`}>
        <span aria-hidden>✣</span>{active ? `技能：${active}` : "启用技能"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md" onClick={() => setOpen(false)}>
          <div className="lglass flex max-h-[82vh] w-[680px] max-w-full flex-col overflow-hidden rounded-[22px] text-ink" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/8 px-5 py-3.5 dark:border-white/8">
              <h3 className="font-disp text-[16px] font-semibold">工作流技能</h3><span className="text-[12px] text-muted">为这次对话加载一套方法</span>
              <button type="button" className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-black/10 dark:border-white/15" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-5">
              {active && <button type="button" onClick={() => { onClear(); setOpen(false); }} className="block w-full rounded-xl border border-[#ff7759]/30 bg-[#ff7759]/8 px-4 py-2.5 text-left text-[13px] text-[#d85a30]">停用当前技能：{active}</button>}
              <button type="button" onClick={beginDraft} className="w-full rounded-xl border border-[#34d399]/35 bg-[#34d399]/8 px-4 py-3 text-left text-[13px] font-medium text-[#18785f] transition hover:bg-[#34d399]/15 dark:text-[#7ce8c5]">＋ 新建技能 / 生成草稿<span className="mt-1 block text-[11px] font-normal opacity-70">根据当前输入生成一个可编辑的技能模板，保存在本浏览器。</span></button>
              {draftMode && editing ? <div className="space-y-2 rounded-xl border border-[#34d399]/40 bg-black/[.03] p-3 dark:bg-white/[.04]">
                <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" placeholder="技能名称" />
                <textarea value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} className="min-h-40 w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-xs leading-5 outline-none dark:border-white/12" placeholder="技能内容" />
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setDraftMode(false); }} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs dark:border-white/12">取消</button><button type="button" onClick={saveDraft} className="rounded-lg bg-[#34d399] px-3 py-1.5 text-xs font-medium text-[#09251b]">保存技能</button></div>
              </div> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {WORKFLOW_SKILLS.map((s) => <button type="button" key={s.id} onClick={() => void applyFile(s)} disabled={loadingId === s.id} className="flex flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]"><div className="text-[14px] font-medium">{loadingId === s.id ? "载入中…" : s.title}</div><div className="mt-1 text-[12px] text-black/50 dark:text-white/45">{s.desc}</div></button>)}
              </div>
              {localSkills.length > 0 && <div className="pt-2 font-mono text-[10.5px] uppercase tracking-wider text-muted">本地技能</div>}
              <div className="grid gap-2 sm:grid-cols-2">
                {localSkills.map((item) => <div key={item.id} className="group rounded-xl border border-[#34d399]/25 bg-[#34d399]/5 p-3.5"><button type="button" onClick={() => { onApply(item.title, item.body); setOpen(false); }} className="block w-full text-left"><div className="truncate text-[14px] font-medium">{item.title}</div><div className="mt-1 line-clamp-2 text-[12px] text-black/50 dark:text-white/45">{item.body}</div></button><div className="mt-2 flex gap-2 text-[11px] opacity-70"><button type="button" onClick={() => { setEditing(item); setDraftMode(true); }} className="hover:underline">编辑</button><button type="button" onClick={() => removeSkill(item.id)} className="hover:underline">删除</button></div></div>)}
              </div>
              {mine.length > 0 && <div className="pt-2 font-mono text-[10.5px] uppercase tracking-wider text-muted">我的云端技能</div>}
              <div className="grid gap-2 sm:grid-cols-2">{mine.map((item, index) => <button type="button" key={`${item.title}-${index}`} onClick={() => { onApply(item.title, item.body); setOpen(false); }} className="flex flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]"><div className="truncate text-[14px] font-medium">{item.title}</div></button>)}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
