"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addWhitelist, deleteWhitelist, reconcileUsageCost, setMonthlyBudget, setUserRole, setWhitelistStatus } from "@/app/admin/actions";
import PageShell from "@/components/studio/PageShell";
import { Hov } from "@/components/studio/ui";
import { addUsageToSummary, billingStateFor, emptyUsageSummary, type BillingState, type UsageSummary } from "@/lib/usage/reporting";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type WL = { id: string; email: string; status: string; requested_at: string; note: string | null };
type Budget = { user_id: string; month_start: string; limit_usd: number | string };
type Usage = {
  id: string;
  request_id: string | null;
  provider_request_id: string | null;
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

type UsageGroup = UsageSummary;
type UserModelGroup = { userId: string; model: string; group: UsageGroup };

const numeric = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const currency = (amount: number, rate: number) => `$${amount.toFixed(6)} · ¥${(amount * rate).toFixed(2)}`;

function buildGroup(rows: Usage[]) {
  return rows.reduce<UsageGroup>((group, row) => addUsageToSummary(group, row), emptyUsageSummary());
}

function unitLabel(row: Usage) {
  if (row.kind === "text") return `${numeric(row.total_tokens).toLocaleString()} tokens`;
  if (row.kind === "image") return `${numeric(row.image_count)} 张${row.resolution ? ` · ${row.resolution}` : ""}`;
  return `${numeric(row.video_seconds)} 秒${row.resolution ? ` · ${row.resolution}` : ""}`;
}

function costLabel(row: Usage, rate: number) {
  const state = billingStateFor(row);
  if (state === "confirmed") return `已对账 ${currency(Math.abs(numeric(row.reported_cost_usd)), rate)}`;
  if (state === "estimated") return `待对账估 ${currency(Math.abs(numeric(row.estimated_cost_usd)), rate)}`;
  if (state === "failed") return row.possibly_charged ? "失败未计费 · 请核对 Wetoken" : "失败未计费";
  return "待定价";
}

function costColor(state: BillingState) {
  if (state === "confirmed") return "var(--accent)";
  if (state === "estimated" || state === "unpriced") return "#e6b85c";
  return "#ff9a8a";
}

export default function AdminConsole({ meId, isSuperadmin, profiles, whitelist, usage, historicalUsage, projectCount, balance, usdToCnyRate, budgets, monthStart, email }: {
  meId: string;
  isSuperadmin: boolean;
  profiles: Profile[];
  whitelist: WL[];
  usage: Usage[];
  historicalUsage: Usage[];
  projectCount: number;
  balance: string | null;
  usdToCnyRate: number;
  budgets: Budget[];
  monthStart: string;
  email?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "whitelist" | "users">("overview");
  const [emailDraft, setEmailDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(monthStart.slice(0, 7));
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [reconcileDrafts, setReconcileDrafts] = useState<Record<string, string>>({});

  useEffect(() => setSelectedMonth(monthStart.slice(0, 7)), [monthStart]);
  useEffect(() => {
    setBudgetDrafts(Object.fromEntries(budgets.map((budget) => [budget.user_id, String((numeric(budget.limit_usd) * usdToCnyRate).toFixed(2))])));
  }, [budgets, monthStart, usdToCnyRate]);

  // The server already fetches the selected Shanghai calendar month. Do not
  // filter by the UTC ISO string here, otherwise late-night local requests can
  // be assigned to the wrong month in the browser.
  const totals = useMemo(() => buildGroup(usage), [usage]);
  const historicalTotals = useMemo(() => buildGroup(historicalUsage), [historicalUsage]);
  const byModel = useMemo(() => {
    const groups: Record<string, UsageGroup> = {};
    for (const row of usage) {
      const key = row.model || "未知模型";
      groups[key] ||= emptyUsageSummary();
      addUsageToSummary(groups[key], row);
    }
    return groups;
  }, [usage]);
  const byUser = useMemo(() => {
    const groups: Record<string, UsageGroup> = {};
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
    return [...groups.values()].sort((a, b) => b.group.quotaReservedUsd - a.group.quotaReservedUsd || b.group.calls - a.group.calls);
  }, [usage]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const budgetByUser = useMemo(() => new Map(budgets.map((budget) => [budget.user_id, budget])), [budgets]);
  const pendingWl = whitelist.filter((item) => item.status === "pending").length;
  const failedPercent = totals.calls ? `${totals.failedCalls} 笔` : "0 笔";

  async function run(fn: () => Promise<unknown>, success = "已保存") {
    setBusy(true);
    setNotice("");
    try {
      const result = await fn();
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

  const tabBtn = (key: "overview" | "whitelist" | "users", label: string) => {
    const active = tab === key;
    return <button key={key} onClick={() => setTab(key)} className="fg-mono" style={{ padding: "8px 15px", borderRadius: 999, cursor: "pointer", fontSize: 12, letterSpacing: .5, textTransform: "uppercase", color: active ? "var(--accent-ink)" : "var(--text-2)", background: active ? "var(--accent)" : "var(--panel)", border: `1px solid ${active ? "transparent" : "var(--stroke)"}` }}>{label}</button>;
  };
  const chip = (text: string, color?: string) => <span style={{ fontSize: 11.5, color: color || "var(--text-2)", padding: "2px 9px", borderRadius: 7, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>{text}</span>;
  const cards = [
    ["用户数", profiles.length.toLocaleString()],
    ["全部项目", projectCount.toLocaleString()],
    ["参与项目", totals.projectIds.size.toLocaleString()],
    ["AI 请求", totals.calls.toLocaleString()],
    ["失败不计费", failedPercent],
    ["TOKENS", totals.totalTokens.toLocaleString()],
    ["生成图片", `${totals.images.toLocaleString()} 张`],
    ["视频时长", `${totals.videoSeconds.toLocaleString()} 秒`],
    ["生成耗时", totals.durationMs ? `${Math.round(totals.durationMs / 1000)} 秒` : "—"],
    ["供应商已确认费用", currency(totals.confirmedCostUsd, usdToCnyRate)],
    ["待对账预估", currency(totals.estimatedCostUsd, usdToCnyRate)],
    ["额度占用", currency(totals.quotaReservedUsd, usdToCnyRate)],
    ["待定价", `${totals.unpricedCalls} 笔`],
    ["DeepSeek 余额", balance || "—"],
  ];
  const historicalCards = [
    ["累计供应商已确认", currency(historicalTotals.confirmedCostUsd, usdToCnyRate)],
    ["累计实时预估", currency(historicalTotals.estimatedCostUsd, usdToCnyRate)],
    ["累计额度占用", currency(historicalTotals.quotaReservedUsd, usdToCnyRate)],
    ["累计待定价", `${historicalTotals.unpricedCalls} 笔`],
  ];

  return (
    <PageShell title="管理后台" email={email}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 30px 70px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
          <div><h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.5px" }}>管理后台</h1><p style={{ margin: "6px 0 0", color: "var(--text-3)", fontSize: 12.5 }}>供应商已确认费用只来自 API 回传或管理员对账；失败任务不自动计费，额度占用 = 已确认 + 待对账预估。</p></div>
          <label className="fg-mono" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-3)", fontSize: 11.5 }}>查询账期<input type="month" value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} style={{ height: 36, borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--panel)", color: "var(--text)", padding: "0 10px", outline: "none" }} /></label>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--text-3)", fontSize: 12.5 }}>当前展示 {monthStart.slice(0, 7)}（上海账期）；1 USD = ¥{usdToCnyRate.toFixed(4)}。实时预估按已知模型价格入账；供应商回传或账单对账后覆盖为实际费用。</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {tabBtn("overview", "概览")}{tabBtn("whitelist", `白名单${pendingWl ? ` · ${pendingWl} 待审` : ""}`)}{tabBtn("users", `用户 · ${profiles.length}`)}
        </div>
        {notice ? <div role="status" style={{ margin: "-8px 0 14px", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: notice.includes("失败") || notice.includes("无效") || notice.includes("必须") ? "#ff9a8a" : "var(--accent)", fontSize: 12.5 }}>{notice}</div> : null}

        {tab === "overview" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 14 }}>
          {cards.map(([label, value]) => <div key={label} style={{ padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}><div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase" }}>{label}</div><div className="fg-mono" style={{ marginTop: 6, fontSize: 19, fontWeight: 600 }}>{value}</div></div>)}

          <section style={{ gridColumn: "1 / -1", padding: "14px 18px", borderRadius: 16, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}>
            <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 9 }}>跨账期累计 · 仅作全局成本参考</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>{historicalCards.map(([label, value]) => <div key={label} style={{ padding: "11px 12px", borderRadius: 11, background: "var(--panel)", border: "1px solid var(--stroke)" }}><div className="fg-mono" style={{ fontSize: 10, letterSpacing: .7, color: "var(--text-3)" }}>{label}</div><div className="fg-mono" style={{ marginTop: 5, fontSize: 15, fontWeight: 600 }}>{value}</div></div>)}</div>
          </section>

          <section style={{ gridColumn: "1 / -1", padding: "16px 18px", borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
            <div className="fg-mono" style={{ fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 12 }}>{monthStart.slice(0, 7)} 按模型</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(245px,1fr))", gap: 9 }}>
              {Object.keys(byModel).length === 0 ? <span style={{ color: "var(--text-3)", fontSize: 13 }}>暂无调用</span> : Object.entries(byModel).map(([model, group]) => <div key={model} style={{ padding: "11px 12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}><div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div><div className="fg-mono" style={{ marginTop: 5, fontSize: 11, color: "var(--text-3)" }}>{group.calls} 次 · {group.images} 图 · {group.videoSeconds} 秒</div><div className="fg-mono" style={{ marginTop: 5, fontSize: 10.5, color: "var(--text-2)" }}>确认 {currency(group.confirmedCostUsd, usdToCnyRate)} · 占用 {currency(group.quotaReservedUsd, usdToCnyRate)}</div>{group.unpricedCalls > 0 || group.failedCalls > 0 ? <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>{group.unpricedCalls > 0 ? chip(`${group.unpricedCalls} 笔待定价`, "#e6b85c") : null}{group.failedCalls > 0 ? chip(`${group.failedCalls} 笔失败不计费`, "#ff9a8a") : null}</div> : null}</div>)}
            </div>
          </section>

          <UsageGroupTable title="按用户 × 模型" groups={byUserModel} profileById={profileById} rate={usdToCnyRate} />

          <section style={{ gridColumn: "1 / -1", borderRadius: 16, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}>
            <div className="fg-mono" style={{ padding: "14px 18px", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", borderBottom: "1px solid var(--stroke)" }}>最近用量与账单对账</div>
            <div style={{ padding: "10px 16px", color: "var(--text-3)", fontSize: 11.5, borderBottom: "1px solid var(--stroke)" }}>在 Wetoken 账单中核对对应 Reference / Request ID 后，录入实际 USD；只有录入后才计入“供应商已确认费用”。</div>
            <div style={{ overflowX: "auto" }}>
              <div className="fg-mono" style={{ minWidth: 1120, display: "grid", gridTemplateColumns: ".6fr 1.7fr 1fr 1.55fr 1.35fr .95fr", padding: "10px 16px", background: "var(--bg-2)", fontSize: 10.5, color: "var(--text-3)" }}><div>类型</div><div>模型 / 请求</div><div>用量</div><div>费用状态</div><div>录入实际 USD</div><div>时间</div></div>
              {usage.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>该账期暂无用量</div> : usage.slice(0, 50).map((row) => {
                const billingState = billingStateFor(row);
                return <div key={row.id} style={{ minWidth: 1120, display: "grid", gridTemplateColumns: ".6fr 1.7fr 1fr 1.55fr 1.35fr .95fr", alignItems: "center", padding: "11px 16px", borderTop: "1px solid var(--stroke)", fontSize: 12.5 }}><div>{chip(row.kind)}</div><div style={{ minWidth: 0 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.model || "未知模型"}</div><div className="fg-mono" style={{ marginTop: 3, fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.provider_request_id || row.request_id || row.id}</div></div><div className="fg-mono" style={{ color: "var(--text-2)" }}>{unitLabel(row)}</div><div className="fg-mono" style={{ color: costColor(billingState), fontSize: 10.5 }}>{costLabel(row, usdToCnyRate)}</div><div>{billingState === "confirmed" ? chip("已完成对账", "var(--accent)") : <div style={{ display: "flex", gap: 6, alignItems: "center" }}><input aria-label="实际美元费用" value={reconcileDrafts[row.id] ?? ""} onChange={(event) => setReconcileDrafts((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="USD" inputMode="decimal" disabled={busy} style={{ width: 80, height: 30, borderRadius: 8, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: "var(--text)", padding: "0 8px", outline: "none", fontSize: 11 }} /><button disabled={busy || !(reconcileDrafts[row.id] ?? "").trim()} onClick={() => run(async () => { await reconcileUsageCost(row.id, reconcileDrafts[row.id] || ""); setReconcileDrafts((current) => ({ ...current, [row.id]: "" })); }, "已记录供应商实际金额")} style={{ height: 30, padding: "0 9px", borderRadius: 8, border: "1px solid var(--stroke)", color: "var(--accent-ink)", background: "var(--accent)", cursor: "pointer", opacity: busy || !(reconcileDrafts[row.id] ?? "").trim() ? .45 : 1, fontSize: 11 }}>对账</button></div>}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 11 }}>{new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div></div>;
              })}
            </div>
          </section>
        </div>}

        {tab === "whitelist" && <div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, padding: 16, borderRadius: 16, background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", marginBottom: 14 }}><div style={{ flex: 1, minWidth: 240 }}><div className="fg-mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 6, letterSpacing: 1 }}>添加白名单邮箱</div><input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} placeholder="someone@beva.com" style={{ width: "100%", height: 40, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 13px", color: "var(--text)", outline: "none", fontSize: 14 }} /></div><Hov as="button" disabled={busy || !emailDraft.trim()} onClick={() => run(async () => { await addWhitelist(emailDraft); setEmailDraft(""); })} base={{ height: 40, padding: "0 16px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !emailDraft.trim() ? .5 : 1 }} hover={{ filter: "brightness(1.08)" }}>添加并批准</Hov></div>
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}><div className="fg-mono" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)" }}><div>邮箱</div><div>状态</div><div>申请时间</div><div style={{ textAlign: "right" }}>操作</div></div>{whitelist.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>暂无白名单记录</div> : whitelist.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}><div>{item.email}</div><div>{chip(item.status, item.status === "approved" ? "var(--accent)" : item.status === "rejected" ? "#ff9a8a" : "var(--text-2)")}</div><div className="fg-mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{new Date(item.requested_at).toLocaleDateString("zh-CN")}</div><div style={{ textAlign: "right", display: "flex", gap: 10, justifyContent: "flex-end" }}>{item.status !== "approved" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "approved"))} style={plainButton("var(--accent)")}>批准</button> : null}{item.status !== "rejected" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "rejected"))} style={plainButton("var(--text-3)")}>拒绝</button> : null}<button onClick={() => run(() => deleteWhitelist(item.id))} style={plainButton("#ff9a8a")}>删除</button></div></div>)}</div>
        </div>}

        {tab === "users" && <div>
          <p style={{ margin: "0 0 12px", color: "var(--text-3)", fontSize: 12.5 }}>{monthStart.slice(0, 7)} 的额度以人民币设置；留空为不限额，0 表示当月禁止调用。额度按服务端账本的“已确认 + 预估占用”拦截，失败任务不会吃掉额度。</p>
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ minWidth: 1180, display: "grid", gridTemplateColumns: "2fr .9fr 1.4fr 1.4fr 1.65fr 1fr", padding: "11px 16px", background: "var(--panel)", borderBottom: "1px solid var(--stroke)", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)" }}><div>邮箱</div><div>用量</div><div>供应商已确认</div><div>额度占用</div><div>月度额度（人民币）</div><div>平台角色</div></div>{profiles.map((profile) => {
            const group = byUser[profile.id] || emptyUsageSummary();
            const configured = budgetByUser.get(profile.id);
            const limitCny = configured ? numeric(configured.limit_usd) * usdToCnyRate : null;
            const remainingCny = limitCny === null ? null : Math.max(0, limitCny - group.quotaReservedUsd * usdToCnyRate);
            return <div key={profile.id} style={{ minWidth: 1180, display: "grid", gridTemplateColumns: "2fr .9fr 1.4fr 1.4fr 1.65fr 1fr", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--stroke)", fontSize: 13 }}><div>{profile.email}{profile.id === meId ? <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}>· 你</span> : null}<div className="fg-mono" style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>{new Date(profile.created_at).toLocaleDateString("zh-CN")}</div></div><div className="fg-mono">{group.calls} 次 · {group.totalTokens.toLocaleString()} T<div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>{group.images} 图 · {group.videoSeconds} 秒 · {group.failedCalls} 失败</div></div><div className="fg-mono">{currency(group.confirmedCostUsd, usdToCnyRate)}</div><div className="fg-mono">{currency(group.quotaReservedUsd, usdToCnyRate)}<div style={{ marginTop: 4, fontSize: 10.5, color: group.estimatedCostUsd ? "#e6b85c" : "var(--text-3)" }}>{group.estimatedCostUsd ? `含待对账估 ${currency(group.estimatedCostUsd, usdToCnyRate)}` : "无待对账预估"}</div></div><div style={{ display: "flex", gap: 7, alignItems: "center" }}><input value={budgetDrafts[profile.id] ?? ""} onChange={(event) => setBudgetDrafts((current) => ({ ...current, [profile.id]: event.target.value }))} inputMode="decimal" placeholder="不限额" disabled={busy} style={{ width: 108, height: 34, borderRadius: 9, border: "1px solid var(--stroke)", background: "var(--bg-2)", padding: "0 9px", color: "var(--text)", outline: "none", fontSize: 12 }} /><button disabled={busy} onClick={() => run(() => setMonthlyBudget(profile.id, monthStart, budgetDrafts[profile.id] ?? ""))} style={{ height: 34, padding: "0 10px", borderRadius: 9, border: "1px solid var(--stroke)", color: "var(--accent-ink)", background: "var(--accent)", cursor: "pointer", fontSize: 12, opacity: busy ? .5 : 1 }}>保存</button><span style={{ fontSize: 10.5, color: remainingCny === null ? "var(--text-3)" : remainingCny <= 0 ? "#ff9a8a" : "var(--accent)" }}>{remainingCny === null ? "不限额" : `余¥${remainingCny.toFixed(2)}`}</span></div><div><select defaultValue={profile.platform_role} disabled={busy || profile.id === meId || (!isSuperadmin && profile.platform_role === "superadmin")} onChange={(event) => run(() => setUserRole(profile.id, event.target.value as "user" | "admin" | "superadmin"))} style={{ borderRadius: 9, border: "1px solid var(--stroke)", background: "var(--panel-solid)", padding: "6px 8px", fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}><option value="user">user</option><option value="admin">admin</option>{isSuperadmin ? <option value="superadmin">superadmin</option> : null}</select></div></div>;
          })}</div></div>
        </div>}
      </div>
    </PageShell>
  );
}

function UsageGroupTable({ title, groups, profileById, rate }: { title: string; groups: UserModelGroup[]; profileById: Map<string, Profile>; rate: number }) {
  return <section style={{ gridColumn: "1 / -1", borderRadius: 16, overflow: "hidden", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)" }}><div className="fg-mono" style={{ padding: "14px 18px", fontSize: 10.5, letterSpacing: 1, color: "var(--text-3)", textTransform: "uppercase", borderBottom: "1px solid var(--stroke)" }}>{title}</div><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ minWidth: 930, display: "grid", gridTemplateColumns: "1.7fr 1.55fr .65fr 1fr 1.35fr 1.35fr", padding: "10px 16px", background: "var(--bg-2)", fontSize: 10.5, color: "var(--text-3)" }}><div>用户</div><div>模型</div><div>请求</div><div>用量</div><div>供应商已确认</div><div>额度占用</div></div>{groups.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)", fontSize: 13 }}>暂无用量</div> : groups.map(({ userId, model, group }) => <div key={`${userId}:${model}`} style={{ minWidth: 930, display: "grid", gridTemplateColumns: "1.7fr 1.55fr .65fr 1fr 1.35fr 1.35fr", alignItems: "center", padding: "11px 16px", borderTop: "1px solid var(--stroke)", fontSize: 12.5 }}><div>{profileById.get(userId)?.email || userId}</div><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div><div>{group.calls}</div><div className="fg-mono">{group.images ? `${group.images} 图` : ""}{group.images && group.videoSeconds ? " · " : ""}{group.videoSeconds ? `${group.videoSeconds} 秒` : group.totalTokens ? `${group.totalTokens.toLocaleString()} T` : "—"}</div><div className="fg-mono">{currency(group.confirmedCostUsd, rate)}</div><div className="fg-mono">{currency(group.quotaReservedUsd, rate)}{group.unpricedCalls ? <span style={{ color: "#e6b85c" }}> · {group.unpricedCalls} 待定</span> : null}</div></div>)}</div></section>;
}

function plainButton(color: string) {
  return { fontSize: 12, color, background: "none", border: "none", cursor: "pointer" } as const;
}
