"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/local/client";
import { listSessions, loadSession, deleteSession, type ChatSession } from "@/lib/chatStore";

export default function ChatHistoryBar({ projectId, scope, sessionId, onLoad, onNew }: {
  projectId: string; scope: string; sessionId: string | null;
  onLoad: (messages: any[], id: string) => void; onNew: () => void;
}) {
  const sb = createClient();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ChatSession[]>([]);
  async function refresh() { setList(await listSessions(sb, projectId, scope)); }
  useEffect(() => { if (open) refresh(); /* eslint-disable-next-line */ }, [open, sessionId]);
  async function pick(id: string) { const msgs = await loadSession(sb, id); onLoad(msgs, id); setOpen(false); }
  async function del(id: string, e: React.MouseEvent) { e.stopPropagation(); if (!confirm("删除这条对话历史？")) return; await deleteSession(sb, id); refresh(); }

  return (
    <div className="relative flex items-center gap-1">
      <button onClick={onNew} title="开始新对话" className="rounded-md border border-[#2c2c36] px-2 py-1 text-[11px] text-[#cfcfda] transition hover:bg-[#24242e]">＋ 新对话</button>
      <button onClick={() => setOpen((o) => !o)} title="历史对话" className="rounded-md border border-[#2c2c36] px-2 py-1 text-[11px] text-[#cfcfda] transition hover:bg-[#24242e]">历史</button>
      {open && (
        <div className="absolute right-0 top-9 z-40 max-h-80 w-64 overflow-auto rounded-xl border border-[#2a2a33] bg-[#15151b] p-1.5 shadow-2xl">
          {list.length === 0 ? (
            <div className="px-2 py-4 text-center text-[12px] text-[#8a8a98]">还没有历史对话</div>
          ) : list.map((s) => (
            <div key={s.id} onClick={() => pick(s.id)} className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] transition ${s.id === sessionId ? "bg-[#24242e]" : "hover:bg-[#1f1f27]"}`}>
              <span className="min-w-0 flex-1 truncate text-[#e8e8ef]">{s.title || "未命名对话"}</span>
              <span className="flex-none font-mono text-[10px] text-[#75758a]">{new Date(s.updated_at).toLocaleDateString("zh-CN")}</span>
              <button onClick={(e) => del(s.id, e)} title="删除" className="flex-none px-1 text-[#8a8a98] opacity-0 transition hover:text-red-400 group-hover:opacity-100">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
