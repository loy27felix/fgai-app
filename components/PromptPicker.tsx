"use client";
import { useEffect, useState } from "react";
import { PROMPT_GROUPS } from "@/lib/skillData";

type Grp = { name: string; items: { title: string; prompt: string }[] };

export default function PromptPicker({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Grp[]>(PROMPT_GROUPS);
  const [active, setActive] = useState(PROMPT_GROUPS[0].name);
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/felix-prompts.json").then((r) => r.json()).then((d) => {
      const fx = (d.tabs || []).map((t: any) => ({ name: "Felix·" + t.name, items: (t.items || []).map((it: any) => ({ title: it.title, prompt: it.prompt })) }));
      setGroups([...PROMPT_GROUPS, ...fx]);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, [open, loaded]);

  const g = groups.find((x) => x.name === active) || groups[0];
  const items = (g?.items || []).filter((it) => !q || (it.title + it.prompt).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1 text-[11.5px] text-white/70 transition hover:bg-white/8">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>插入 Prompt
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md" onClick={() => setOpen(false)}>
          <div className="lglass flex max-h-[82vh] w-[680px] max-w-full flex-col overflow-hidden rounded-[22px] text-ink" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/8 px-5 py-3.5 dark:border-white/8">
              <h3 className="font-disp text-[16px] font-semibold">插入 Prompt 片段</h3>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索提示词…" className="ml-auto w-52 rounded-lg border border-hairline bg-transparent px-3 py-1.5 text-[13px] outline-none focus:border-[#34d399]" />
              <button className="grid h-8 w-8 place-items-center rounded-lg border border-black/10 dark:border-white/15" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-black/8 px-5 py-3 dark:border-white/8">
              {groups.map((x) => (<button key={x.name} onClick={() => setActive(x.name)} className={`rounded-full px-3 py-1 text-[12px] transition ${x.name === active ? "bg-[#34d399] text-[#0a2018]" : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/8 dark:text-white/60"}`}>{x.name}</button>))}
            </div>
            <div className="grid flex-1 gap-3 overflow-auto p-5 sm:grid-cols-2">
              {items.map((it, i) => (
                <button key={i} onClick={() => { onInsert(it.prompt); setOpen(false); }} className="flex flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]">
                  <div className="text-[14px] font-medium">{it.title}</div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-black/50 dark:text-white/45">{it.prompt}</div>
                </button>
              ))}
              {items.length === 0 && <div className="col-span-full py-10 text-center text-[13px] text-muted">无匹配</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
