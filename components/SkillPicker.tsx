"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WORKFLOW_SKILLS } from "@/lib/skillData";

export default function SkillPicker({ active, onApply, onClear }: {
  active: string | null; onApply: (name: string, content: string) => void; onClear: () => void;
}) {
  const sb = createClient();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<{ title: string; body: string }[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => { if (!open) return; sb.from("custom_presets").select("title,body").order("created_at", { ascending: false }).then(({ data }) => setMine((data as any) || [])); }, [open]);

  async function applyFile(s: { id: string; title: string; file: string }) {
    setLoadingId(s.id);
    try { const r = await fetch(`/skills/${s.file}`); const t = await r.text(); onApply(s.title, t); setOpen(false); }
    catch { alert("读取技能失败"); } finally { setLoadingId(null); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition ${active ? "border-[#34d399]/40 bg-[#34d399]/12 text-[#5fe3c0]" : "border-white/12 text-white/70 hover:bg-white/8"}`}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6V21h3l6-6a4 4 0 0 0 5.6-5.6l-2.3 2.3-2.6-2.6 2.3-2.3z" /></svg>
        {active ? `技能：${active}` : "启用技能"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md" onClick={() => setOpen(false)}>
          <div className="lglass flex max-h-[82vh] w-[600px] max-w-full flex-col overflow-hidden rounded-[22px] text-ink" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/8 px-5 py-3.5 dark:border-white/8">
              <h3 className="font-disp text-[16px] font-semibold">启用工作流技能</h3>
              <span className="text-[12px] text-muted">启用后 AI 整段对话按该方法工作</span>
              <button className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-black/10 dark:border-white/15" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-5">
              {active && <button onClick={() => { onClear(); setOpen(false); }} className="block w-full rounded-xl border border-[#ff7759]/30 bg-[#ff7759]/8 px-4 py-2.5 text-left text-[13px] text-[#d85a30]">✕ 停用当前技能「{active}」</button>}
              <div className="grid gap-2 sm:grid-cols-2">
                {WORKFLOW_SKILLS.map((s) => (
                  <button key={s.id} onClick={() => applyFile(s)} disabled={loadingId === s.id} className="flex flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]">
                    <div className="text-[14px] font-medium">{loadingId === s.id ? "载入中…" : s.title}</div>
                    <div className="mt-1 text-[12px] text-black/50 dark:text-white/45">{s.desc}</div>
                  </button>
                ))}
              </div>
              {mine.length > 0 && <div className="pt-2 font-mono text-[10.5px] uppercase tracking-wider text-muted">我的技能</div>}
              <div className="grid gap-2 sm:grid-cols-2">
                {mine.map((m, i) => (<button key={i} onClick={() => { onApply(m.title, m.body); setOpen(false); }} className="flex flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]"><div className="truncate text-[14px] font-medium">{m.title}</div></button>))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
