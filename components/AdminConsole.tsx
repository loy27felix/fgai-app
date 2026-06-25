"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addWhitelist, setWhitelistStatus, deleteWhitelist, setUserRole } from "@/app/admin/actions";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type WL = { id: string; email: string; status: string; requested_at: string; note: string | null };
type Usage = { model: string | null; total_tokens: number | null; created_at: string };

export default function AdminConsole({
  meId, isSuperadmin, profiles, whitelist, usage, projectCount, balance,
}: {
  meId: string; isSuperadmin: boolean;
  profiles: Profile[]; whitelist: WL[]; usage: Usage[]; projectCount: number; balance: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "whitelist" | "users">("overview");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const calls = usage.length;
  const tokens = usage.reduce((s, u) => s + (u.total_tokens || 0), 0);
  const byModel = usage.reduce<Record<string, number>>((m, u) => { const k = u.model || "?"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const pendingWl = whitelist.filter((w) => w.status === "pending").length;

  async function run(fn: () => Promise<any>) { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <h1 className="font-disp text-[30px] font-semibold tracking-tight">管理后台</h1>
      <div className="my-5 flex gap-2">
        {([["overview", "概览"], ["whitelist", `白名单${pendingWl ? ` · ${pendingWl}待审` : ""}`], ["users", `用户 · ${profiles.length}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)} className={tabCls(tab === k)}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([["用户数", profiles.length], ["项目数", projectCount], ["待审白名单", pendingWl], ["AI 调用次数", calls], ["AI 总 tokens", tokens.toLocaleString()], ["DeepSeek 余额", balance || "—"]] as const).map(([l, v]) => (
            <div key={l} className="lglass rounded-[18px] p-5">
              <div className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">{l}</div>
              <div className="mt-1.5 font-disp text-[28px] font-semibold tracking-tight">{v}</div>
            </div>
          ))}
          <div className="lglass rounded-[18px] p-5 sm:col-span-2 lg:col-span-3">
            <div className="font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]">按模型 · 调用次数</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.keys(byModel).length === 0 ? <span className="text-[13px] text-muted">暂无调用</span>
                : Object.entries(byModel).map(([m, n]) => <span key={m} className="chip">{m} · {n}</span>)}
            </div>
          </div>
        </div>
      )}

      {tab === "whitelist" && (
        <div>
          <div className="lglass rounded-[20px] mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[260px] flex-1"><label className="label">添加白名单邮箱（非 @beva.com 也可注册）</label>
              <input className="input" value={email} placeholder="someone@gmail.com" onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="rounded-full bg-[#34d399] px-4 py-2 text-[12.5px] font-medium text-[#0a2018] active:scale-[.98] disabled:opacity-50" disabled={busy || !email.trim()} onClick={() => run(async () => { await addWhitelist(email); setEmail(""); })}>添加并批准</button>
          </div>
          <div className="lglass rounded-[20px] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-[#f2f2f2] text-left font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]"><th className="p-3">邮箱</th><th>状态</th><th>申请时间</th><th className="text-right pr-3">操作</th></tr></thead>
              <tbody>
                {whitelist.length === 0 ? <tr><td className="p-3 text-muted" colSpan={4}>暂无白名单记录</td></tr> :
                  whitelist.map((w) => (
                    <tr key={w.id} className="border-b border-[#f6f6f6]">
                      <td className="p-3">{w.email}</td>
                      <td><span className={`chip ${w.status === "approved" ? "chip-green" : w.status === "rejected" ? "chip-coral" : ""}`}>{w.status}</span></td>
                      <td className="text-muted">{new Date(w.requested_at).toLocaleDateString("zh-CN")}</td>
                      <td className="pr-3 text-right">
                        {w.status !== "approved" && <button className="text-[12px] text-[#1d9e75] dark:text-[#5fe3c0] underline mr-3" onClick={() => run(() => setWhitelistStatus(w.id, "approved"))}>批准</button>}
                        {w.status !== "rejected" && <button className="text-[12px] text-muted underline mr-3" onClick={() => run(() => setWhitelistStatus(w.id, "rejected"))}>拒绝</button>}
                        <button className="text-[12px] text-coral underline" onClick={() => run(() => deleteWhitelist(w.id))}>删除</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="lglass rounded-[20px] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-[#f2f2f2] text-left font-mono text-[10.5px] uppercase tracking-wide text-[#75758a]"><th className="p-3">邮箱</th><th>平台角色</th><th>注册时间</th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b border-[#f6f6f6]">
                  <td className="p-3">{p.email}{p.id === meId && <span className="ml-2 chip">你</span>}</td>
                  <td>
                    <select defaultValue={p.platform_role} disabled={busy || p.id === meId || (!isSuperadmin && p.platform_role === "superadmin")}
                      className="rounded-lg border border-hairline px-2 py-1.5 text-[12.5px]"
                      onChange={(e) => run(() => setUserRole(p.id, e.target.value as any))}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                      <option value="superadmin">superadmin</option>
                    </select>
                  </td>
                  <td className="text-muted">{new Date(p.created_at).toLocaleDateString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function tabCls(active: boolean) {
  return ["rounded-full border px-4 py-1.5 font-mono text-[12px] uppercase tracking-wide transition",
    active ? "border-[#34d399]/40 bg-[#34d399]/14 text-[#1d9e75] dark:text-[#5fe3c0]" : "border-black/12 text-black/55 hover:border-black/35 dark:border-white/15 dark:text-white/55"].join(" ");
}
