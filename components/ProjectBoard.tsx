"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project, Role } from "@/lib/types";
import { createProject, requestJoin, approveJoin, deleteProject } from "@/app/projects/actions";

type Pending = { requestId: string; user_id: string; email: string };
const ease = "transition duration-500 ease-[cubic-bezier(.32,.72,0,1)]";

function Arrow() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function Trash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></svg>; }
function Plus() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>; }

export default function ProjectBoard({ projects, myRole, myApplied, pending, counts, userId }: {
  projects: Project[]; myRole: Record<string, Role>; myApplied: string[];
  pending: Record<string, Pending[]>; counts: Record<string, number>; userId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const applied = new Set(myApplied);
  const list = projects.filter((p) => (tab === "mine" ? !!myRole[p.id] : true));

  async function onJoin(id: string) { await requestJoin(id); router.refresh(); }
  async function onApprove(p: Pending, projectId: string) { await approveJoin(p.requestId, projectId, p.user_id); router.refresh(); }
  async function onDelete(id: string, name: string) {
    if (!confirm(`确定删除项目「${name}」？\n剧本、分镜、资产等全部内容将一并永久删除，且不可恢复。`)) return;
    setBusyId(id); const r = await deleteProject(id); setBusyId(null);
    if (r?.error) { alert("删除失败：" + r.error); return; }
    router.refresh();
  }

  const mineCount = projects.filter((p) => !!myRole[p.id]).length;
  const pendCount = Object.values(pending).reduce((a, b) => a + b.length, 0);
  return (
    <div className="mx-auto max-w-[1180px] px-6 pb-24 pt-6">
      {/* 仪表盘 hero */}
      <div className="lglass relative overflow-hidden rounded-[26px] px-7 py-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(52,211,153,.22),transparent_70%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#1d9e75] dark:text-[#5fe3c0]">FG STUDIO · 工作台</span>
            <h1 className="mt-3 font-disp text-[clamp(28px,3.6vw,40px)] font-semibold tracking-tighter">你的项目</h1>
            <p className="mt-2 text-[13.5px] text-black/50 dark:text-white/50">每个故事 = 一个项目 = 一个带记忆的 Agent。</p>
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
              {[["项目", String(projects.length)], ["我参与", String(mineCount)], ["待审批", String(pendCount)]].map(([k, v]) => (
                <div key={k}><div className="font-mono text-[20px] font-medium tracking-tight">{v}</div><div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">{k}</div></div>
              ))}
            </div>
          </div>
          <button onClick={() => setShowNew((s) => !s)} className={`group inline-flex items-center gap-2.5 rounded-full bg-[#15151a] py-2 pl-5 pr-2 text-[13.5px] font-medium text-white active:scale-[.98] dark:bg-white dark:text-[#0a0f24] ${ease}`}>
            新建项目 <span className={`grid h-8 w-8 place-items-center rounded-full bg-white/15 group-hover:rotate-90 dark:bg-black/10 ${ease}`}><Plus /></span>
          </button>
        </div>
      </div>

      {showNew && (
        <form action={createProject} className="card mt-6 flex flex-wrap items-end gap-3 p-4">
          <div className="w-20"><label className="label">图标</label><input name="emoji" defaultValue="🎬" className="input text-center" /></div>
          <div className="min-w-[200px] flex-1"><label className="label">项目名称</label><input name="name" required placeholder="例如：狼和七只小山羊" className="input" /></div>
          <div className="min-w-[220px] flex-[2]"><label className="label">简介（可选）</label><input name="summary" placeholder="暗黑童话短剧 · 6 集" className="input" /></div>
          <button className="inline-flex items-center gap-2 rounded-full bg-[#34d399] px-5 py-2.5 text-[13px] font-medium text-[#0a2018] active:scale-[.98]" type="submit">创建并进入 <Arrow /></button>
        </form>
      )}

      {/* 标签 */}
      <div className="my-7 flex gap-2">
        {(["all", "mine"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full border px-4 py-1.5 font-mono text-[12px] uppercase tracking-wide ${ease} ${tab === t ? "border-[#34d399] bg-[#34d399]/12 text-[#1d9e75] dark:text-[#5fe3c0]" : "border-black/10 text-black/50 hover:border-black/30 dark:border-white/12 dark:text-white/50 dark:hover:border-white/30"}`}>
            {t === "all" ? `全部项目 · ${projects.length}` : `我的项目 · ${projects.filter((p) => !!myRole[p.id]).length}`}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-black/12 py-24 text-center dark:border-white/12">
          <p className="text-[15px] font-medium">还没有项目</p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">点右上角「新建项目」，从故事圣经开始。</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-5">
          {list.map((p) => {
            const role = myRole[p.id];
            const isOwner = p.created_by === userId || role === "owner";
            const emoji = p.story_bible?._emoji || "";
            const pend = pending[p.id] || [];
            return (
              <div key={p.id} className={`group rounded-[22px] border border-black/6 bg-black/[.02] p-1.5 ring-1 ring-black/5 hover:-translate-y-1 dark:border-white/8 dark:bg-white/[.03] dark:ring-white/8 ${ease}`}>
                <div className="overflow-hidden rounded-[calc(22px-0.375rem)] bg-white dark:bg-white/[.02]">
                  <div className="relative flex h-[128px] items-end p-3.5" style={{ background: p.cover || "linear-gradient(140deg,#0a3d34,#05221d)" }}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-transparent" />
                    {emoji && <span className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-[21px] ring-1 ring-white/20 backdrop-blur-md">{emoji}</span>}
                    {role && <span className="relative rounded-full bg-white/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-white ring-1 ring-white/15 backdrop-blur-md">{isOwner ? "负责人" : role}</span>}
                    {isOwner && (
                      <button title="删除项目" onClick={() => onDelete(p.id, p.name)} disabled={busyId === p.id}
                        className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-lg bg-black/35 text-white opacity-0 backdrop-blur hover:bg-red-500 group-hover:opacity-100 ${ease} disabled:opacity-40`}>
                        {busyId === p.id ? "…" : <Trash />}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2.5 p-4">
                    <h3 className="font-disp text-[19px] font-semibold tracking-tight">{p.name}</h3>
                    <p className="min-h-[40px] flex-1 text-[13.5px] leading-relaxed text-black/50 dark:text-white/45">{p.summary || "暂无简介"}</p>
                    <div className="flex items-center justify-between border-t border-black/6 pt-3 dark:border-white/8">
                      <span className="text-[12px] text-black/40 dark:text-white/40">{counts[p.id] ? `${counts[p.id]} 名成员` : "未加入"}</span>
                      {role ? (
                        <Link href={`/projects/${p.id}/bible`} className={`group/btn inline-flex items-center gap-1.5 rounded-full bg-[#15151a] py-1.5 pl-3.5 pr-1.5 text-[12.5px] font-medium text-white dark:bg-white dark:text-[#0a0f24] ${ease}`}>进入 <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 group-hover/btn:translate-x-0.5 dark:bg-black/10">{<Arrow />}</span></Link>
                      ) : applied.has(p.id) ? (
                        <span className="rounded-full border border-[#ff7759]/40 bg-[#ff7759]/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-[#ff7759]">待审批</span>
                      ) : (
                        <button onClick={() => onJoin(p.id)} className="rounded-full border border-black/12 px-3 py-1.5 text-[12.5px] hover:border-black/40 dark:border-white/15 dark:hover:border-white/40">申请加入</button>
                      )}
                    </div>
                    {isOwner && pend.length > 0 && (
                      <div className="mt-1 rounded-xl bg-black/[.03] p-3 dark:bg-white/[.04]">
                        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">待审批 · {pend.length}</div>
                        {pend.map((a) => (
                          <div key={a.requestId} className="flex items-center justify-between py-1 text-[13px]">
                            <span className="truncate">{a.email}</span>
                            <button onClick={() => onApprove(a, p.id)} className="rounded-full bg-[#34d399] px-3 py-1 text-[12px] font-medium text-[#0a2018]">通过</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
