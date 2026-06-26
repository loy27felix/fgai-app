"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addWhitelist, setWhitelistStatus, deleteWhitelist, setUserRole } from "@/app/admin/actions";
import PageShell from "@/components/studio/PageShell";
import { Hov } from "@/components/studio/ui";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type WL = { id: string; email: string; status: string; requested_at: string; note: string | null };
type Usage = { model: string | null; total_tokens: number | null; created_at: string };

export default function AdminConsole({ meId, isSuperadmin, profiles, whitelist, usage, projectCount, balance, email }: {
  meId: string; isSuperadmin: boolean; profiles: Profile[]; whitelist: WL[]; usage: Usage[]; projectCount: number; balance: string | null; email?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "whitelist" | "users">("overview");
  const [em, setEm] = useState("");
  const [busy, setBusy] = useState(false);
  const calls = usage.length;
  const tokens = usage.reduce((s, u) => s + (u.total_tokens || 0), 0);
  const byModel = usage.reduce<Record<string, number>>((m, u) => { const k = u.model || "?"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const pendingWl = whitelist.filter((w) => w.status === "pending").length;
  async function run(fn: () => Promise<any>) { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } }

  const tabBtn = (k: string, l: string) => { const on = tab === k; return <button key={k} onClick={() => setTab(k as any)} className="fg-mono" style={{ padding: "8px 15px", borderRadius: 999, cursor: "pointer", fontSize: 12, letterSpacing: .5, textTransform: "uppercase", color: on ? "var(--accent-ink)" : "var(--text-2)", background: on ? "var(--accent)" : "var(--panel)", border: `1px solid ${on ? "transparent" : "var(--stroke)"}` }}>{l}</button>; };
  const chip = (t: string, c?: string) => <span style={{ fontSize: 11.5, color: c || "var(--text-2)", padding: "2px 9px", borderRadius: 7, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>{t}</span>;

  return (
    <PageShell title="管理后台" email={email}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 30px 70px" }}>
        <h1 style={{ margin: "0 0 16px", fontSize: 26, fontWeight: 700, letterSpacing: "-.5px" }}>管理后台</h1>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>{tabBtn("overview", "概览")}{tabBtn("whitelist", `白名单${pendingWl ? " · " + pendingWl + "待审" : ""}`)}{tabBtn("users", `用户 · ${profiles.length}`)}</div>

        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
            {([["用户数", String(profiles.length)], ["项目数", String(projectCount)], ["待审白名单", String(pendingWl)], ["AI 调用次数", String(calls)], ["AI 总 tokens", tokens.toLocaleString()], ["DeepSeek 余额", balance || "—"]] as const).map(([l, v]) => (
              <div key={l} style={{ padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
                <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>{l}</div>
                <div className="fg-mono" style={{ marginTop: 6, fontSize: 25, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 10 }}>按模型 · 调用次数</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{Object.keys(byModel).length === 0 ? <span style={{ color: "var(--text-3)", fontSize: 13 }}>暂无调用</span> : Object.entries(byModel).map(([m, n]) => chip(`${m} · ${n}`))}</div>
            </div>
          </div>
        )}

        {tab === "whitelist" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, padding: 16, borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 240 }}><div className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 6, letterSpacing: 1 }}>添加白名单邮箱</div><input value={em} onChange={(e) => setEm(e.target.value)} placeholder="someone@gmail.com" style={{ width: "100%", height: 40, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 13px", color: "var(--text)", outline: "none", fontSize: 14 }} /></div>
              <Hov as="button" disabled={busy || !em.trim()} onClick={() => run(async () => { await addWhitelist(em); setEm(""); })} base={{ height: 40, padding: "0 16px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !em.trim() ? 0.5 : 1 }} hover={{ filter: "brightness(1.08)" }}>添加并批准</Hov>
            </div>
            <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}><div>邮箱</div><div>状态</div><div>申请时间</div><div style={{ textAlign: "right" }}>操作</div></div>
              {whitelist.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>暂无白名单记录</div> : whitelist.map((w) => (
                <div key={w.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}>
                  <div>{w.email}</div><div>{chip(w.status, w.status === "approved" ? "var(--accent)" : w.status === "rejected" ? "#ff9a8a" : "var(--text-2)")}</div>
                  <div className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{new Date(w.requested_at).toLocaleDateString("zh-CN")}</div>
                  <div style={{ textAlign: "right", display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    {w.status !== "approved" && <button onClick={() => run(() => setWhitelistStatus(w.id, "approved"))} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>批准</button>}
                    {w.status !== "rejected" && <button onClick={() => run(() => setWhitelistStatus(w.id, "rejected"))} style={{ fontSize: 12, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}>拒绝</button>}
                    <button onClick={() => run(() => deleteWhitelist(w.id))} style={{ fontSize: 12, color: "#ff9a8a", background: "none", border: "none", cursor: "pointer" }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "users" && (
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
            <div className="fg-mono" style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}><div>邮箱</div><div>平台角色</div><div>注册时间</div></div>
            {profiles.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}>
                <div>{p.email}{p.id === meId && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}>· 你</span>}</div>
                <div><select defaultValue={p.platform_role} disabled={busy || p.id === meId || (!isSuperadmin && p.platform_role === "superadmin")} onChange={(e) => run(() => setUserRole(p.id, e.target.value as any))} style={{ borderRadius: 9, border: "1px solid var(--stroke)", background: "var(--panel-solid)", padding: "6px 8px", fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}><option value="user">user</option><option value="admin">admin</option><option value="superadmin">superadmin</option></select></div>
                <div className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{new Date(p.created_at).toLocaleDateString("zh-CN")}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
