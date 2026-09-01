"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addWhitelist, deleteWhitelist, setMonthlyBudget, setUserRole, setWhitelistStatus } from "@/app/admin/actions";
import PageShell from "@/components/studio/PageShell";
import { Hov } from "@/components/studio/ui";
import { addUsageToSummary, emptyUsageSummary, type UsageSummary } from "@/lib/usage/reporting";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type Whitelist = { id: string; email: string; status: string; requested_at: string };
type Budget = { user_id: string; month_start: string; limit_usd: number | string };
type Usage = {
  id: string;
  request_id: string | null;
  provider_request_id: string | null;
  user_id: string;
  kind: "text" | "image" | "video";
  model: string | null;
  total_tokens: number | null;
  image_count: number | null;
  video_seconds: number | null;
  duration_ms: number | null;
  resolution: string | null;
  reported_cost_usd: number | string | null;
  estimated_cost_usd: number | string | null;
  status: string;
  created_at: string;
};
type UserModelGroup = { userId: string; model: string; group: UsageSummary };

const numeric = (value: number | string | null | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : 0;
};
const money = (usd: number, rate: number) => `$${usd.toFixed(4)} · ¥${(usd * rate).toFixed(2)}`;

function buildGroup(rows: Usage[]) {
  return rows.reduce<UsageSummary>((summary, row) => addUsageToSummary(summary, row), emptyUsageSummary());
}

function unitLabel(row: Usage) {
  if (row.kind === "image") return `${numeric(row.image_count)} 张${row.resolution ? ` · ${row.resolution}` : ""}`;
  if (row.kind === "video") return `${numeric(row.video_seconds)} 秒${row.resolution ? ` · ${row.resolution}` : ""}`;
  return `${numeric(row.total_tokens).toLocaleString()} tokens`;
}

function statusLabel(status: string) {
  return status === "succeeded" ? "成功" : status === "failed" ? "失败" : "生成中";
}

function rowCost(row: Usage, rate: number) {
  if (row.status === "failed") return "¥0.00";
  if (row.status !== "succeeded") return "—";
  const usd = row.reported_cost_usd === null || row.reported_cost_usd === undefined
    ? numeric(row.estimated_cost_usd)
    : numeric(row.reported_cost_usd);
  return usd > 0 ? money(usd, rate) : "—";
}

export default function AdminConsole({ meId, isSuperadmin, profiles, whitelist, usage, usdToCnyRate, budgets, monthStart, email }: {
  meId: string;
  isSuperadmin: boolean;
  profiles: Profile[];
  whitelist: Whitelist[];
  usage: Usage[];
  usdToCnyRate: number;
  budgets: Budget[];
  monthStart: string;
  email?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "whitelist" | "users">("overview");
  const [emailDraft, setEmailDraft] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(monthStart.slice(0, 7));

  useEffect(() => setSelectedMonth(monthStart.slice(0, 7)), [monthStart]);
  useEffect(() => {
    setBudgetDrafts(Object.fromEntries(budgets.map((budget) => [budget.user_id, (numeric(budget.limit_usd) * usdToCnyRate).toFixed(2)])));
  }, [budgets, monthStart, usdToCnyRate]);

  const totals = useMemo(() => buildGroup(usage), [usage]);
  const processingCalls = Math.max(0, totals.calls - totals.successfulCalls - totals.failedCalls);
  const byModel = useMemo(() => {
    const groups: Record<string, UsageSummary> = {};
    for (const row of usage) {
      const key = row.model || "未知模型";
      groups[key] ||= emptyUsageSummary();
      addUsageToSummary(groups[key], row);
    }
    return groups;
  }, [usage]);
  const byUser = useMemo(() => {
    const groups: Record<string, UsageSummary> = {};
    for (const row of usage) {
      groups[row.user_id] ||= emptyUsageSummary();
      addUsageToSummary(groups[row.user_id], row);
    }
    return groups;
  }, [usage]);
  const byUserModel = useMemo(() => {
    const groups = new Map<string, UserModelGroup>();
    for (const row of usage) {
      const model = row.model || "未知模型";
      const key = `${row.user_id}:${model}`;
      const current = groups.get(key) || { userId: row.user_id, model, group: emptyUsageSummary() };
      addUsageToSummary(current.group, row);
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => b.group.successfulCostUsd - a.group.successfulCostUsd || b.group.successfulCalls - a.group.successfulCalls);
  }, [usage]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const budgetByUser = useMemo(() => new Map(budgets.map((budget) => [budget.user_id, budget])), [budgets]);
  const pendingWhitelist = whitelist.filter((item) => item.status === "pending").length;

  async function run(action: () => Promise<unknown>, success = "已保存") {
    setBusy(true);
    setNotice("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
        setNotice(result.error);
        return;
      }
      setNotice(success);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function selectMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    setSelectedMonth(value);
    router.push(`/admin?month=${value}`);
  }

  const tabButton = (key: typeof tab, label: string) => <button key={key} onClick={() => setTab(key)} className="fg-mono" style={{ padding: "8px 15px", borderRadius: 999, cursor: "pointer", fontSize: 12, letterSpacing: .5, color: tab === key ? "var(--accent-ink)" : "var(--text-2)", background: tab === key ? "var(--accent)" : "var(--panel)", border: `1px solid ${tab === key ? "transparent" : "var(--stroke)"}` }}>{label}</button>;
  const chip = (label: string, color?: string) => <span style={{ padding: "2px 8px", borderRadius: 7, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: color || "var(--text-2)", fontSize: 11 }}>{label}</span>;
  const cards = [
    ["成功生成", `${totals.successfulCalls} 次`],
    ["生成失败", `${totals.failedCalls} 次`],
    ["生成中", `${processingCalls} 次`],
    ["本月费用", money(totals.successfulCostUsd, usdToCnyRate)],
    ["成功图片", `${totals.successfulImages} 张`],
    ["成功视频", `${totals.successfulVideoSeconds} 秒`],
  ];

  return <PageShell title="管理后台" email={email}>
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 30px 70px" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div><h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-.5px" }}>管理后台</h1><p style={{ margin: "6px 0 0", color: "var(--text-3)", fontSize: 12.5 }}>成功任务按当前模型价格计费；失败任务费用固定为 ¥0。生成提交时会临时锁定额度，失败后自动释放。</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><Link href="/admin/reports" style={reportLinkStyle}>服务监控报表</Link><label className="fg-mono" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-3)", fontSize: 11.5 }}>查询月份<input type="month" value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} style={inputStyle} /></label></div>
      </header>
      <p style={{ margin: "0 0 16px", color: "var(--text-3)", fontSize: 12.5 }}>当前展示 {monthStart.slice(0, 7)}（上海账期）；1 USD = ¥{usdToCnyRate.toFixed(4)}。</p>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>{tabButton("overview", "概览")}{tabButton("whitelist", `白名单${pendingWhitelist ? ` · ${pendingWhitelist} 待审` : ""}`)}{tabButton("users", `用户 · ${profiles.length}`)}</nav>
      {notice ? <div role="status" style={{ margin: "-8px 0 14px", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: notice.includes("失败") ? "#ff9a8a" : "var(--accent)", fontSize: 12.5 }}>{notice}</div> : null}

      {tab === "overview" ? <Overview cards={cards} byModel={byModel} byUserModel={byUserModel} profileById={profileById} rate={usdToCnyRate} usage={usage} chip={chip} /> : null}
      {tab === "whitelist" ? <WhitelistPanel whitelist={whitelist} emailDraft={emailDraft} setEmailDraft={setEmailDraft} run={run} busy={busy} chip={chip} /> : null}
      {tab === "users" ? <UsersPanel profiles={profiles} byUser={byUser} budgetByUser={budgetByUser} budgetDrafts={budgetDrafts} setBudgetDrafts={setBudgetDrafts} monthStart={monthStart} rate={usdToCnyRate} run={run} busy={busy} meId={meId} isSuperadmin={isSuperadmin} /> : null}
    </main>
  </PageShell>;
}

function Overview({ cards, byModel, byUserModel, profileById, rate, usage, chip }: { cards: string[][]; byModel: Record<string, UsageSummary>; byUserModel: UserModelGroup[]; profileById: Map<string, Profile>; rate: number; usage: Usage[]; chip: (label: string, color?: string) => JSX.Element }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 14 }}>
    {cards.map(([label, value]) => <section key={label} style={cardStyle}><div className="fg-mono" style={cardLabelStyle}>{label}</div><div className="fg-mono" style={{ marginTop: 7, fontSize: 18, fontWeight: 600 }}>{value}</div></section>)}
    <section style={{ ...panelStyle, gridColumn: "1 / -1" }}><div className="fg-mono" style={sectionTitleStyle}>按模型</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 9 }}>{Object.keys(byModel).length === 0 ? <p style={{ color: "var(--text-3)", margin: 0 }}>本月暂无调用</p> : Object.entries(byModel).map(([model, group]) => <div key={model} style={{ padding: "12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{model}</strong><div className="fg-mono" style={{ marginTop: 6, color: "var(--text-3)", fontSize: 11 }}>{group.successfulCalls} 成功 · {group.failedCalls} 失败 · {group.successfulImages} 图 · {group.successfulVideoSeconds} 秒</div><div className="fg-mono" style={{ marginTop: 6, fontSize: 12 }}>{money(group.successfulCostUsd, rate)}</div></div>)}</div></section>
    <UsageGroups groups={byUserModel} profileById={profileById} rate={rate} />
    <section style={{ ...panelStyle, gridColumn: "1 / -1", overflow: "hidden", padding: 0 }}><div className="fg-mono" style={{ ...sectionTitleStyle, padding: "14px 18px", borderBottom: "1px solid var(--stroke)" }}>本月生成记录</div><div style={{ overflowX: "auto" }}><div className="fg-mono" style={tableHeaderStyle}><div>状态</div><div>模型 / 任务</div><div>用量</div><div>费用</div><div>时间</div></div>{usage.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>本月暂无生成记录</div> : usage.slice(0, 100).map((row) => <div key={row.id} style={tableRowStyle}><div>{chip(statusLabel(row.status), row.status === "failed" ? "#ff9a8a" : row.status === "succeeded" ? "var(--accent)" : "#e6b85c")}</div><div style={{ minWidth: 0 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.model || "未知模型"}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{row.provider_request_id || row.request_id || row.id}</div></div><div className="fg-mono" style={{ color: "var(--text-2)", fontSize: 11 }}>{unitLabel(row)}</div><div className="fg-mono" style={{ color: row.status === "failed" ? "#ff9a8a" : "var(--text)", fontSize: 11 }}>{rowCost(row, rate)}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>{new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div></div>)}</div></section>
  </div>;
}

function UsageGroups({ groups, profileById, rate }: { groups: UserModelGroup[]; profileById: Map<string, Profile>; rate: number }) {
  return <section style={{ ...panelStyle, gridColumn: "1 / -1", overflow: "hidden", padding: 0 }}><div className="fg-mono" style={{ ...sectionTitleStyle, padding: "14px 18px", borderBottom: "1px solid var(--stroke)" }}>按用户 × 模型</div><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 880, gridTemplateColumns: "1.7fr 1.6fr .8fr 1fr 1fr" }}><div>用户</div><div>模型</div><div>成功 / 失败</div><div>图片 / 视频</div><div>费用</div></div>{groups.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>本月暂无用量</div> : groups.map(({ userId, model, group }) => <div key={`${userId}:${model}`} style={{ ...tableRowStyle, minWidth: 880, gridTemplateColumns: "1.7fr 1.6fr .8fr 1fr 1fr" }}><div>{profileById.get(userId)?.email || userId}</div><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div><div>{group.successfulCalls} / {group.failedCalls}</div><div>{group.successfulImages} 图 · {group.successfulVideoSeconds} 秒</div><div className="fg-mono">{money(group.successfulCostUsd, rate)}</div></div>)}</div></section>;
}

function WhitelistPanel({ whitelist, emailDraft, setEmailDraft, run, busy, chip }: { whitelist: Whitelist[]; emailDraft: string; setEmailDraft: (value: string) => void; run: (action: () => Promise<unknown>, success?: string) => Promise<void>; busy: boolean; chip: (label: string, color?: string) => JSX.Element }) {
  return <div><div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, ...panelStyle, marginBottom: 14 }}><div style={{ flex: 1, minWidth: 240 }}><div className="fg-mono" style={{ ...cardLabelStyle, marginBottom: 6 }}>添加白名单邮箱</div><input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} placeholder="someone@beva.com" style={{ ...inputStyle, width: "100%" }} /></div><Hov as="button" disabled={busy || !emailDraft.trim()} onClick={() => run(async () => { await addWhitelist(emailDraft); setEmailDraft(""); })} base={{ height: 36, padding: "0 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !emailDraft.trim() ? .5 : 1 }} hover={{ filter: "brightness(1.08)" }}>添加并批准</Hov></div><section style={{ ...panelStyle, overflow: "hidden", padding: 0 }}><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 700, gridTemplateColumns: "2fr 1fr 1fr 1.3fr" }}><div>邮箱</div><div>状态</div><div>申请时间</div><div style={{ textAlign: "right" }}>操作</div></div>{whitelist.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>暂无白名单记录</div> : whitelist.map((item) => <div key={item.id} style={{ ...tableRowStyle, minWidth: 700, gridTemplateColumns: "2fr 1fr 1fr 1.3fr" }}><div>{item.email}</div><div>{chip(item.status, item.status === "approved" ? "var(--accent)" : item.status === "rejected" ? "#ff9a8a" : "#e6b85c")}</div><div>{new Date(item.requested_at).toLocaleDateString("zh-CN")}</div><div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>{item.status !== "approved" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "approved"))} style={plainButton("var(--accent)")}>批准</button> : null}{item.status !== "rejected" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "rejected"))} style={plainButton("var(--text-3)")}>拒绝</button> : null}<button onClick={() => run(() => deleteWhitelist(item.id))} style={plainButton("#ff9a8a")}>删除</button></div></div>)}</div></section></div>;
}

function UsersPanel({ profiles, byUser, budgetByUser, budgetDrafts, setBudgetDrafts, monthStart, rate, run, busy, meId, isSuperadmin }: { profiles: Profile[]; byUser: Record<string, UsageSummary>; budgetByUser: Map<string, Budget>; budgetDrafts: Record<string, string>; setBudgetDrafts: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void; monthStart: string; rate: number; run: (action: () => Promise<unknown>, success?: string) => Promise<void>; busy: boolean; meId: string; isSuperadmin: boolean }) {
  return <div><p style={{ margin: "0 0 12px", color: "var(--text-3)", fontSize: 12.5 }}>月额度使用人民币设置。成功任务会计入已用；提交生成时系统会先临时锁定额度，失败后自动释放。</p><section style={{ ...panelStyle, overflow: "hidden", padding: 0 }}><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 1060, gridTemplateColumns: "2fr 1fr 1.25fr 1.8fr 1fr" }}><div>用户</div><div>成功 / 失败</div><div>本月费用</div><div>月额度（人民币）</div><div>平台角色</div></div>{profiles.map((profile) => { const group = byUser[profile.id] || emptyUsageSummary(); const budget = budgetByUser.get(profile.id); const limitCny = budget ? numeric(budget.limit_usd) * rate : null; return <div key={profile.id} style={{ ...tableRowStyle, minWidth: 1060, gridTemplateColumns: "2fr 1fr 1.25fr 1.8fr 1fr", alignItems: "center" }}><div>{profile.email}{profile.id === meId ? <small style={{ marginLeft: 7, color: "var(--accent)" }}>你</small> : null}</div><div>{group.successfulCalls} / {group.failedCalls}</div><div className="fg-mono">{money(group.successfulCostUsd, rate)}</div><div style={{ display: "flex", gap: 7, alignItems: "center" }}><input value={budgetDrafts[profile.id] ?? ""} onChange={(event) => setBudgetDrafts((current) => ({ ...current, [profile.id]: event.target.value }))} inputMode="decimal" placeholder="不限额" disabled={busy} style={{ ...inputStyle, width: 100 }} /><button disabled={busy} onClick={() => run(() => setMonthlyBudget(profile.id, monthStart, budgetDrafts[profile.id] ?? ""))} style={{ height: 34, padding: "0 10px", borderRadius: 9, border: "none", color: "var(--accent-ink)", background: "var(--accent)", cursor: "pointer", opacity: busy ? .5 : 1 }}>保存</button><span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{limitCny === null ? "不限额" : `上限 ¥${limitCny.toFixed(2)}`}</span></div><select defaultValue={profile.platform_role} disabled={busy || profile.id === meId || (!isSuperadmin && profile.platform_role === "superadmin")} onChange={(event) => run(() => setUserRole(profile.id, event.target.value as "user" | "admin" | "superadmin"))} style={{ borderRadius: 8, border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text)", padding: "6px 8px" }}><option value="user">user</option><option value="admin">admin</option>{isSuperadmin ? <option value="superadmin">superadmin</option> : null}</select></div>; })}</div></section></div>;
}

const cardStyle = { padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" } as const;
const panelStyle = { padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" } as const;
const cardLabelStyle = { fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" } as const;
const sectionTitleStyle = { margin: 0, fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" } as const;
const inputStyle = { height: 36, borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: "var(--text)", padding: "0 10px", outline: "none" } as const;
const reportLinkStyle = { display: "inline-flex", alignItems: "center", height: 36, padding: "0 12px", borderRadius: 10, color: "var(--accent)", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)", fontSize: 12.5 } as const;
const tableHeaderStyle = { minWidth: 860, display: "grid", gridTemplateColumns: ".65fr 1.8fr 1fr 1.2fr .8fr", gap: 10, padding: "10px 16px", background: "var(--bg-2)", fontSize: 10.5, color: "var(--text-3)" } as const;
const tableRowStyle = { minWidth: 860, display: "grid", gridTemplateColumns: ".65fr 1.8fr 1fr 1.2fr .8fr", gap: 10, padding: "11px 16px", borderTop: "1px solid var(--stroke)", fontSize: 12.5 } as const;
const plainButton = (color: string) => ({ fontSize: 12, color, background: "none", border: "none", cursor: "pointer" } as const);
