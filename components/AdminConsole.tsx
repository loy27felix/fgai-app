"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addWhitelist, deleteWhitelist, setMonthlyBudget, setUserRole, setWhitelistStatus } from "@/app/admin/actions";
import PageShell from "@/components/studio/PageShell";
import { Hov } from "@/components/studio/ui";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type WL = { id: string; email: string; status: string; requested_at: string; note: string | null };
type Budget = { user_id: string; month_start: string; limit_usd: number | string };
type Usage = {
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  kind: "text" | "image" | "video";
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  image_count: number | null;
  video_seconds: number | null;
  duration_ms: number | null;
  resolution: string | null;
  generate_audio: boolean | null;
  reported_cost_usd: number | string | null;
  estimated_cost_usd: number | string | null;
  cost_source: "reported" | "estimated" | "unknown";
  status: string;
  possibly_charged: boolean;
  created_at: string;
};

type UsageGroup = { calls: number; tokens: number; images: number; videoSeconds: number; durationMs: number; cost: number; unpriced: number; projectIds: Set<string> };

const emptyGroup = (): UsageGroup => ({ calls: 0, tokens: 0, images: 0, videoSeconds: 0, durationMs: 0, cost: 0, unpriced: 0, projectIds: new Set<string>() });
const numeric = (value: number | string | null | undefined) => Number(value || 0);
const knownCost = (row: Usage) => Math.abs(numeric(row.reported_cost_usd ?? row.estimated_cost_usd));

function addUsage(group: UsageGroup, row: Usage) {
  group.calls += 1;
  group.tokens += numeric(row.total_tokens);
  group.images += numeric(row.image_count);
  group.videoSeconds += numeric(row.video_seconds);
  group.durationMs += numeric(row.duration_ms);
  const contextId = row.project_id || row.workspace_id;
  if (contextId) group.projectIds.add(contextId);
  group.cost += knownCost(row);
  if (row.cost_source === "unknown") group.unpriced += 1;
}

export default function AdminConsole({ meId, isSuperadmin, profiles, whitelist, usage, projectCount, balance, usdToCnyRate, budgets, monthStart, email }: {
  meId: string;
  isSuperadmin: boolean;
  profiles: Profile[];
  whitelist: WL[];
  usage: Usage[];
  projectCount: number;
  balance: string | null;
  usdToCnyRate: number;
  budgets: Budget[];
  monthStart: string;
  email?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "whitelist" | "users">("overview");
  const [em, setEm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>(() => Object.fromEntries(budgets.map((budget) => [budget.user_id, String((numeric(budget.limit_usd) * usdToCnyRate).toFixed(2))])));
  const monthlyUsage = usage.filter((row) => row.created_at.startsWith(monthStart.slice(0, 7)));
  const totals = monthlyUsage.reduce((group, row) => { addUsage(group, row); return group; }, emptyGroup());
  const byModel = monthlyUsage.reduce<Record<string, UsageGroup>>((groups, row) => {
    const key = row.model || "未知模型";
    groups[key] ||= emptyGroup();
    addUsage(groups[key], row);
    return groups;
  }, {});
  const byUser = monthlyUsage.reduce<Record<string, UsageGroup>>((groups, row) => {
    groups[row.user_id] ||= emptyGroup();
    addUsage(groups[row.user_id], row);
    return groups;
  }, {});
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const budgetByUser = new Map(budgets.map((budget) => [budget.user_id, budget]));
  const pendingWl = whitelist.filter((item) => item.status === "pending").length;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const result = await fn();
      if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
        setNotice(result.error);
        return;
      }
      setNotice("已保存");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (key: "overview" | "whitelist" | "users", label: string) => {
    const active = tab === key;
    return <button key={key} onClick={() => setTab(key)} className="fg-mono" style={{ padding: "8px 15px", borderRadius: 999, cursor: "pointer", fontSize: 12, letterSpacing: .5, textTransform: "uppercase", color: active ? "var(--accent-ink)" : "var(--text-2)", background: active ? "var(--accent)" : "var(--panel)", border: `1px solid ${active ? "transparent" : "var(--stroke)"}` }}>{label}</button>;
  };
  const chip = (text: string, color?: string) => <span style={{ fontSize: 11.5, color: color || "var(--text-2)", padding: "2px 9px", borderRadius: 7, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>{text}</span>;
  const priceLabel = (row: Usage) => row.cost_source === "unknown"
    ? "待定价"
    : `$${knownCost(row).toFixed(10)} · ¥${(knownCost(row) * usdToCnyRate).toFixed(4)} · ${row.cost_source === "reported" ? "供应商返回" : "估算"}`;
  const unitLabel = (row: Usage) => row.kind === "text"
    ? `${numeric(row.total_tokens).toLocaleString()} tokens`
    : row.kind === "image"
      ? `${numeric(row.image_count)} 张${row.resolution ? ` · ${row.resolution}` : ""}`
      : `${numeric(row.video_seconds)} 秒${row.resolution ? ` · ${row.resolution}` : ""}`;

  const cards = [
    ["用户数", profiles.length.toLocaleString()],
    ["全部项目", projectCount.toLocaleString()],
    ["本月参与项目", totals.projectIds.size.toLocaleString()],
    ["本月 AI 请求", totals.calls.toLocaleString()],
    ["本月 TOKENS", totals.tokens.toLocaleString()],
    ["本月生成图片", `${totals.images.toLocaleString()} 张`],
    ["本月视频时长", `${totals.videoSeconds.toLocaleString()} 秒`],
    ["本月生成耗时", totals.durationMs ? `${Math.round(totals.durationMs / 1000)} 秒` : "—"],
    ["本月已核算费用", `$${totals.cost.toFixed(6)} · ¥${(totals.cost * usdToCnyRate).toFixed(2)}`],
    ["待定价", `${totals.unpriced.toLocaleString()} 笔`],
    ["DeepSeek 余额", balance || "—"],
  ];

  return (
    <PageShell title="管理后台" email={email}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "26px 30px 70px" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, letterSpacing: "-.5px" }}>管理后台</h1>
        <p style={{ margin: "0 0 16px", color: "var(--text-3)", fontSize: 12.5 }}>可信用量账本 · 当前展示 {monthStart.slice(0, 7)} 的月度统计与额度；费用同时显示 USD 与 CNY，未知报价保留为待定价（1 USD = ¥{usdToCnyRate.toFixed(4)}）</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {tabBtn("overview", "概览")}
          {tabBtn("whitelist", `白名单${pendingWl ? ` · ${pendingWl} 待审` : ""}`)}
          {tabBtn("users", `用户 · ${profiles.length}`)}
        </div>
        {notice ? <div role="status" style={{ margin: "-8px 0 14px", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: notice === "已保存" ? "var(--accent)" : "#ff9a8a", fontSize: 12.5 }}>{notice}</div> : null}

        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 14 }}>
            {cards.map(([label, value]) => (
              <div key={label} style={{ padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
                <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>{label}</div>
                <div className="fg-mono" style={{ marginTop: 6, fontSize: 23, fontWeight: 600 }}>{value}</div>
              </div>
            ))}

            <section style={{ gridColumn: "1 / -1", padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 12 }}>本月按模型</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 9 }}>
                {Object.keys(byModel).length === 0 ? <span style={{ color: "var(--text-3)", fontSize: 13 }}>暂无调用</span> : Object.entries(byModel).map(([model, group]) => (
                  <div key={model} style={{ padding: "11px 12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{model}</div>
                    <div className="fg-mono" style={{ marginTop: 5, fontSize: 11, color: "var(--text-3)" }}>{group.calls} 次 · {group.tokens.toLocaleString()} tokens · ${group.cost.toFixed(6)} · ¥{(group.cost * usdToCnyRate).toFixed(4)}</div>
                    {group.unpriced > 0 && <div style={{ marginTop: 6 }}>{chip(`${group.unpriced} 笔待定价`, "#e6b85c")}</div>}
                  </div>
                ))}
              </div>
            </section>

            <section style={{ gridColumn: "1 / -1", borderRadius: 16, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ padding: "14px 18px", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", borderBottom: "1px solid var(--stroke)" }}>本月按用户</div>
              <div style={{ overflowX: "auto" }}>
                <div className="fg-mono" style={{ minWidth: 780, display: "grid", gridTemplateColumns: "2fr .6fr 1fr 1.4fr .7fr", padding: "10px 16px", background: "var(--bg-2)", fontSize: 10.5, color: "var(--text-3)" }}><div>用户</div><div>请求</div><div>TOKENS</div><div>已核算 USD / CNY</div><div>待定价</div></div>
                {Object.keys(byUser).length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>暂无用量</div> : Object.entries(byUser).map(([userId, group]) => (
                  <div key={userId} style={{ minWidth: 780, display: "grid", gridTemplateColumns: "2fr .6fr 1fr 1.4fr .7fr", alignItems: "center", padding: "11px 16px", borderTop: "1px solid var(--stroke)", fontSize: 12.5 }}>
                    <div>{profileById.get(userId)?.email || userId}</div><div>{group.calls}</div><div>{group.tokens.toLocaleString()}</div><div className="fg-mono">${group.cost.toFixed(6)} · ¥{(group.cost * usdToCnyRate).toFixed(4)}</div><div>{group.unpriced || "—"}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ gridColumn: "1 / -1", borderRadius: 16, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ padding: "14px 18px", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", borderBottom: "1px solid var(--stroke)" }}>最近用量</div>
              <div style={{ overflowX: "auto" }}>
                <div className="fg-mono" style={{ minWidth: 850, display: "grid", gridTemplateColumns: ".6fr 1.8fr 1.2fr 1.35fr 1fr", padding: "10px 16px", background: "var(--bg-2)", fontSize: 10.5, color: "var(--text-3)" }}><div>类型</div><div>模型</div><div>用量</div><div>费用</div><div>时间</div></div>
                {usage.slice(0, 30).map((row, index) => (
                  <div key={`${row.created_at}-${index}`} style={{ minWidth: 850, display: "grid", gridTemplateColumns: ".6fr 1.8fr 1.2fr 1.35fr 1fr", alignItems: "center", padding: "11px 16px", borderTop: "1px solid var(--stroke)", fontSize: 12.5 }}>
                    <div>{chip(row.kind)}</div><div>{row.model || "未知模型"}</div><div className="fg-mono" style={{ color: "var(--text-2)" }}>{unitLabel(row)}</div><div className="fg-mono" style={{ color: row.cost_source === "unknown" ? "#e6b85c" : "var(--text-2)" }}>{priceLabel(row)}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 11 }}>{new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "whitelist" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, padding: 16, borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 240 }}><div className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 6, letterSpacing: 1 }}>添加白名单邮箱</div><input value={em} onChange={(event) => setEm(event.target.value)} placeholder="someone@gmail.com" style={{ width: "100%", height: 40, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 13px", color: "var(--text)", outline: "none", fontSize: 14 }} /></div>
              <Hov as="button" disabled={busy || !em.trim()} onClick={() => run(async () => { await addWhitelist(em); setEm(""); })} base={{ height: 40, padding: "0 16px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !em.trim() ? 0.5 : 1 }} hover={{ filter: "brightness(1.08)" }}>添加并批准</Hov>
            </div>
            <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)" }}><div>邮箱</div><div>状态</div><div>申请时间</div><div style={{ textAlign: "right" }}>操作</div></div>
              {whitelist.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>暂无白名单记录</div> : whitelist.map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}>
                  <div>{item.email}</div><div>{chip(item.status, item.status === "approved" ? "var(--accent)" : item.status === "rejected" ? "#ff9a8a" : "var(--text-2)")}</div><div className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{new Date(item.requested_at).toLocaleDateString("zh-CN")}</div>
                  <div style={{ textAlign: "right", display: "flex", gap: 10, justifyContent: "flex-end" }}>{item.status !== "approved" && <button onClick={() => run(() => setWhitelistStatus(item.id, "approved"))} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>批准</button>}{item.status !== "rejected" && <button onClick={() => run(() => setWhitelistStatus(item.id, "rejected"))} style={{ fontSize: 12, color: "var(--text-3)", background: "none", border: "none", cursor: "pointer" }}>拒绝</button>}<button onClick={() => run(() => deleteWhitelist(item.id))} style={{ fontSize: 12, color: "#ff9a8a", background: "none", border: "none", cursor: "pointer" }}>删除</button></div>
                </div>
              ))}
            </div>
          </div>
        )}

{tab === "users" && (
          <div>
            <p style={{ margin: "0 0 12px", color: "var(--text-3)", fontSize: 12.5 }}>本月额度以人民币设置；留空为不限额，设置为 0 表示本月禁止继续调用。额度按服务端 USD 账本拦截，未知价格的模型在启用额度后也会被拦截。</p>
            <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
              <div className="fg-mono" style={{ minWidth: 1050, display: "grid", gridTemplateColumns: "2fr .9fr 1.45fr 1.65fr 1fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)" }}><div>邮箱</div><div>本月用量</div><div>本月费用 / 剩余</div><div>月度额度（人民币）</div><div>平台角色</div></div>
              <div style={{ overflowX: "auto" }}>
                {profiles.map((profile) => {
                  const group = byUser[profile.id] || emptyGroup();
                  const configured = budgetByUser.get(profile.id);
                  const limitCny = configured ? numeric(configured.limit_usd) * usdToCnyRate : null;
                  const remainingCny = limitCny === null ? null : Math.max(0, limitCny - group.cost * usdToCnyRate);
                  return (
                    <div key={profile.id} style={{ minWidth: 1050, display: "grid", gridTemplateColumns: "2fr .9fr 1.45fr 1.65fr 1fr", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}>
                      <div>{profile.email}{profile.id === meId && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}>· 你</span>}<div className="fg-mono" style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>{new Date(profile.created_at).toLocaleDateString("zh-CN")}</div></div>
                      <div className="fg-mono">{group.calls} 次 · {group.tokens.toLocaleString()} T<div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>{group.images} 图 · {group.videoSeconds} 秒 · {group.projectIds.size} 项目</div></div>
                      <div className="fg-mono">¥{(group.cost * usdToCnyRate).toFixed(2)}<div style={{ marginTop: 4, fontSize: 10.5, color: remainingCny === null ? "var(--text-3)" : remainingCny <= 0 ? "#ff9a8a" : "var(--accent)" }}>{remainingCny === null ? "不限额" : `剩余 ¥${remainingCny.toFixed(2)}`}{group.unpriced > 0 ? ` · ${group.unpriced} 笔待定价` : ""}</div></div>
                      <div style={{ display: "flex", gap: 7, alignItems: "center" }}><input value={budgetDrafts[profile.id] ?? ""} onChange={(event) => setBudgetDrafts((current) => ({ ...current, [profile.id]: event.target.value }))} inputMode="decimal" placeholder="不限额" disabled={busy} style={{ width: 108, height: 34, borderRadius: 9, border: "1px solid var(--stroke)", background: "var(--bg-2)", padding: "0 9px", color: "var(--text)", outline: "none", fontSize: 12 }} /><button disabled={busy} onClick={() => run(() => setMonthlyBudget(profile.id, monthStart, budgetDrafts[profile.id] ?? ""))} style={{ height: 34, padding: "0 10px", borderRadius: 9, border: "1px solid var(--stroke)", color: "var(--accent-ink)", background: "var(--accent)", cursor: "pointer", fontSize: 12, opacity: busy ? .5 : 1 }}>保存</button></div>
                      <div><select defaultValue={profile.platform_role} disabled={busy || profile.id === meId || (!isSuperadmin && profile.platform_role === "superadmin")} onChange={(event) => run(() => setUserRole(profile.id, event.target.value as "user" | "admin" | "superadmin"))} style={{ borderRadius: 9, border: "1px solid var(--stroke)", background: "var(--panel-solid)", padding: "6px 8px", fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}><option value="user">user</option><option value="admin">admin</option>{isSuperadmin ? <option value="superadmin">superadmin</option> : null}</select></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
