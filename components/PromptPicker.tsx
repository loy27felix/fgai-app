"use client";

import { useEffect, useMemo, useState } from "react";
import { PROMPT_GROUPS } from "@/lib/skillData";

type Grp = { name: string; items: { title: string; prompt: string }[] };
type PromptCache = { savedAt: number; groups: Grp[] };
const PROMPT_CACHE_KEY = "fg-prompt-library-v1";
const PROMPT_CACHE_TTL = 6 * 60 * 60 * 1000;
const promptSource = process.env.NEXT_PUBLIC_PROMPT_LIBRARY_URL || "/felix-prompts.json";

function normalizeRemoteGroups(payload: any): Grp[] {
  return (payload?.tabs || []).map((tab: any) => ({
    name: `Felix · ${String(tab.name || "远程")}`,
    items: (tab.items || []).filter((item: any) => item?.title && item?.prompt).map((item: any) => ({ title: String(item.title), prompt: String(item.prompt) })),
  })).filter((group: Grp) => group.items.length);
}

function readCache(): PromptCache | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(PROMPT_CACHE_KEY) || "null");
    return value?.savedAt && Array.isArray(value.groups) ? value as PromptCache : null;
  } catch { return null; }
}

export default function PromptPicker({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Grp[]>(PROMPT_GROUPS as Grp[]);
  const [active, setActive] = useState(PROMPT_GROUPS[0]?.name || "");
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sourceStatus, setSourceStatus] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!open || loaded) return;
    const cache = readCache();
    if (cache?.groups?.length) {
      setGroups([...PROMPT_GROUPS as Grp[], ...cache.groups.filter((group) => !group.name.startsWith("Felix ·") || !PROMPT_GROUPS.some((item) => item.name === group.name))]);
      setSourceStatus(`已使用缓存 · ${new Date(cache.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    }
    const shouldFetch = !cache || Date.now() - cache.savedAt > PROMPT_CACHE_TTL;
    if (!shouldFetch) { setLoaded(true); return; }
    void refreshPrompts();
  }, [open, loaded, refreshNonce]);

  async function refreshPrompts() {
    setRefreshing(true);
    try {
      const response = await fetch(`${promptSource}${promptSource.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("prompt source unavailable");
      const remote = normalizeRemoteGroups(await response.json());
      const next = [...PROMPT_GROUPS as Grp[], ...remote];
      setGroups(next);
      window.localStorage.setItem(PROMPT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), groups: remote } satisfies PromptCache));
      setSourceStatus(`已更新 · ${remote.reduce((sum, group) => sum + group.items.length, 0)} 条远程提示词`);
    } catch {
      setSourceStatus("使用内置提示词");
    } finally { setRefreshing(false); setLoaded(true); }
  }

  const g = groups.find((group) => group.name === active) || groups[0];
  const items = useMemo(() => (g?.items || []).filter((item) => !q || (item.title + item.prompt).toLowerCase().includes(q.toLowerCase())), [g, q]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1 text-[11.5px] text-white/70 transition hover:bg-white/8"><span aria-hidden>＋</span>插入 Prompt</button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4 backdrop-blur-md" onClick={() => setOpen(false)}>
          <div className="prompt-library-dialog lglass flex max-h-[82vh] w-[900px] max-w-full flex-col overflow-hidden rounded-[22px] text-ink" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-3 border-b border-black/8 px-5 py-3.5 dark:border-white/8"><h3 className="font-disp text-[16px] font-semibold">提示词库</h3><span className="text-[12px] text-muted">选择后插入当前输入框</span><input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索提示词…" className="ml-auto w-52 rounded-lg border border-hairline bg-transparent px-3 py-1.5 text-[13px] outline-none focus:border-[#34d399]" /><button type="button" onClick={() => { setLoaded(false); setRefreshNonce((value) => value + 1); }} disabled={refreshing} className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs dark:border-white/15">{refreshing ? "更新中…" : "刷新"}</button><button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-black/10 dark:border-white/15" onClick={() => setOpen(false)}>×</button></div>
            <div className="flex flex-wrap gap-1.5 border-b border-black/8 px-5 py-3 dark:border-white/8">{groups.map((group) => <button type="button" key={group.name} onClick={() => setActive(group.name)} className={`rounded-full px-3 py-1 text-[12px] transition ${group.name === active ? "bg-[#34d399] text-[#0a2018]" : "bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/8 dark:text-white/60"}`}>{group.name}</button>)}</div>
            <div className="flex items-center justify-between px-5 pt-3 text-[11px] text-muted"><span>{sourceStatus || "内置提示词"}</span><span>{items.length} 条</span></div>
            <div className="grid flex-1 gap-3 overflow-auto p-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <button type="button" key={`${item.title}-${index}`} onClick={() => { onInsert(item.prompt); setOpen(false); }} className="prompt-library-card flex min-h-32 flex-col rounded-xl border border-black/8 bg-black/[.02] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#34d399]/40 dark:border-white/8 dark:bg-white/[.03]"><div className="text-[14px] font-medium">{item.title}</div><div className="mt-1 line-clamp-4 text-[12px] leading-relaxed text-black/50 dark:text-white/45">{item.prompt}</div></button>)}{items.length === 0 && <div className="col-span-full py-10 text-center text-[13px] text-muted">无匹配</div>}</div>
          </div>
        </div>
      )}
    </>
  );
}
