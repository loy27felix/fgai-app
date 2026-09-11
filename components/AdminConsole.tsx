"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addWhitelist, assignWetokenFeeAttribution, deleteWhitelist, setMonthlyBudget, setUserRole, setWhitelistStatus } from "@/app/admin/actions";
import PageShell from "@/components/studio/PageShell";
import { Hov } from "@/components/studio/ui";
import { addUsageToSummary, emptyUsageSummary, type UsageSummary } from "@/lib/usage/reporting";
import { summarizeWetokenFeeAttributions, type WetokenFeeAssignmentKind, type WetokenFeeUsageKind } from "@/lib/usage/wetoken-fee-attribution";

type Profile = { id: string; email: string; platform_role: string; created_at: string };
type Whitelist = { id: string; email: string; status: string; requested_at: string };
type Budget = { user_id: string; month_start: string; limit_usd: number | string };
type FeeImport = {
  imported_count: number | string;
  imported_cost_usd: number | string;
  ledger_matched_count: number | string;
  ledger_matched_cost_usd: number | string;
  creator_recovered_count: number | string;
  creator_recovered_cost_usd: number | string;
  project_recovered_count: number | string;
  project_recovered_cost_usd: number | string;
  unallocated_count: number | string;
  unallocated_cost_usd: number | string;
  ambiguous_count: number | string;
  ambiguous_cost_usd: number | string;
  breakdown: unknown;
  created_at: string;
};
type FeeException = {
  id: string;
  reference_id: string;
  model: string | null;
  occurred_at: string | null;
  actual_cost_usd: number | string;
  classification: "unallocated_historical" | "ambiguous" | string;
  assignment_kind: WetokenFeeAssignmentKind | string | null;
  assigned_user_id: string | null;
  assigned_usage_kind: WetokenFeeUsageKind | null;
  assignment_note: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  assignment_ledger_id: string | null;
};
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
// Ledger storage remains USD for provider reconciliation, while the product
// surface is intentionally RMB-only for the team.
const money = (usd: number, rate: number) => `¥${(usd * rate).toFixed(2)}`;

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
  const reported = numeric(row.reported_cost_usd);
  if (row.reported_cost_usd !== null && row.reported_cost_usd !== undefined) return money(reported, rate);
  if (row.status === "failed") return "¥0.00";
  return numeric(row.estimated_cost_usd) > 0 ? "待导入实际账单" : "待对账";
}

function feeExceptionAssignmentKind(value: FeeException): WetokenFeeAssignmentKind {
  return value.assignment_kind === "user" || value.assignment_kind === "company" ? value.assignment_kind : "pending";
}

function feeExceptionModelBreakdown(rows: FeeException[]) {
  const totals = new Map<string, { model: string; count: number; costUsd: number }>();
  for (const row of rows) {
    if (feeExceptionAssignmentKind(row) !== "pending") continue;
    const model = row.model || "未提供模型名";
    const current = totals.get(model) || { model, count: 0, costUsd: 0 };
    current.count += 1;
    current.costUsd += numeric(row.actual_cost_usd);
    totals.set(model, current);
  }
  return [...totals.values()].sort((left, right) => right.costUsd - left.costUsd || right.count - left.count).slice(0, 6);
}

function reconciliationNotice(payload: Record<string, unknown>, rate: number) {
  const imported = money(numeric(payload.totalCostUsd as number | string), rate);
  const direct = numeric(payload.ledgerMatchedCostUsd as number | string);
  const creator = numeric(payload.creatorRecoveredCostUsd as number | string);
  const project = numeric(payload.projectRecoveredCostUsd as number | string);
  const assigned = money(direct + creator + project, rate);
  const unallocated = numeric(payload.unallocatedCostUsd as number | string);
  const ambiguous = numeric(payload.ambiguousCostUsd as number | string);
  return `账单消费 ${imported}；已归属用户 ${assigned}（账本直接匹配 ${numeric(payload.ledgerMatchedCount as number | string)} 笔，历史任务补回 ${numeric(payload.creatorRecoveredCount as number | string) + numeric(payload.projectRecoveredCount as number | string)} 笔）${unallocated ? `；无本地归属 ${money(unallocated, rate)}（${numeric(payload.unallocatedCount as number | string)} 笔）` : ""}${ambiguous ? `；任务冲突 ${money(ambiguous, rate)}（${numeric(payload.ambiguousCount as number | string)} 笔）` : ""}。`;
}

export default function AdminConsole({ meId, isSuperadmin, profiles, whitelist, usage, usdToCnyRate, budgets, latestFeeImport, feeExceptions, monthStart, email }: {
  meId: string;
  isSuperadmin: boolean;
  profiles: Profile[];
  whitelist: Whitelist[];
  usage: Usage[];
  usdToCnyRate: number;
  budgets: Budget[];
  latestFeeImport: FeeImport | null;
  feeExceptions: FeeException[];
  monthStart: string;
  email?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "attribution" | "whitelist" | "users">("overview");
  const [emailDraft, setEmailDraft] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(monthStart.slice(0, 7));
  const feeLogInputRef = useRef<HTMLInputElement>(null);

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
  const feeAttribution = useMemo(() => summarizeWetokenFeeAttributions(feeExceptions.map((row) => ({
    classification: row.classification === "ambiguous" ? "ambiguous" : "unallocated_historical",
    actualCostUsd: numeric(row.actual_cost_usd),
    assignmentKind: feeExceptionAssignmentKind(row),
  }))), [feeExceptions]);

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

  async function importWetokenFeeLog(file: File) {
    setReconciling(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("month", monthStart);
      const response = await fetch("/api/admin/usage/wetoken-fee-log", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "导入实际账单失败");
      setNotice(reconciliationNotice(payload, usdToCnyRate));
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入实际账单失败");
    } finally {
      setReconciling(false);
    }
  }

  const tabButton = (key: typeof tab, label: string) => <button key={key} onClick={() => setTab(key)} className="fg-mono" style={{ padding: "8px 15px", borderRadius: 999, cursor: "pointer", fontSize: 12, letterSpacing: .5, color: tab === key ? "var(--accent-ink)" : "var(--text-2)", background: tab === key ? "var(--accent)" : "var(--panel)", border: `1px solid ${tab === key ? "transparent" : "var(--stroke)"}` }}>{label}</button>;
  const chip = (label: string, color?: string) => <span style={{ padding: "2px 8px", borderRadius: 7, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: color || "var(--text-2)", fontSize: 11 }}>{label}</span>;
  const cards = [
    ["成功生成", `${totals.successfulCalls} 次`],
    ["生成失败", `${totals.failedCalls} 次`],
    ["生成中", `${processingCalls} 次`],
    ["实际已确认", money(totals.confirmedCostUsd, usdToCnyRate)],
    ["合规暂估", money(totals.estimatedCostUsd, usdToCnyRate)],
    ["待对账任务", `${totals.unpricedCalls} 次`],
    ["成功图片", `${totals.successfulImages} 张`],
    ["成功视频", `${totals.successfulVideoSeconds} 秒`],
  ];

  return <PageShell title="管理后台" email={email}>
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 30px 70px" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div><h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-.5px" }}>管理后台</h1><p style={{ margin: "6px 0 0", color: "var(--text-3)", fontSize: 12.5 }}>团队统计只对管理员开放；成员在画布内仅能查看自己的本月记录。费用先按相同 WeToken Reference ID 自动归属；历史例外进入“费用归属”池，由管理员明确记到用户或公司成本，绝不按模型、金额或时间猜测分摊。</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><input ref={feeLogInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void importWetokenFeeLog(file); }} /><button type="button" disabled={reconciling} onClick={() => feeLogInputRef.current?.click()} style={{ ...reportLinkStyle, cursor: reconciling ? "wait" : "pointer", opacity: reconciling ? .65 : 1 }}>{reconciling ? "正在导入实际账单…" : "导入 WeToken 实际账单 CSV"}</button><Link href="/admin/logs" style={reportLinkStyle}>日志检索</Link><Link href="/admin/reports" style={reportLinkStyle}>服务监控报表</Link><label className="fg-mono" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-3)", fontSize: 11.5 }}>查询月份<input type="month" value={selectedMonth} onChange={(event) => selectMonth(event.target.value)} style={inputStyle} /></label></div>
      </header>
      <p style={{ margin: "0 0 16px", color: "var(--text-3)", fontSize: 12.5 }}>当前展示 {monthStart.slice(0, 7)}（上海账期）；所有费用按当前结算汇率统一展示为人民币。</p>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>{tabButton("overview", "概览")}{tabButton("attribution", `费用归属${feeAttribution.pendingCount ? ` · ${feeAttribution.pendingCount} 待处理` : ""}`)}{tabButton("whitelist", `白名单${pendingWhitelist ? ` · ${pendingWhitelist} 待审` : ""}`)}{tabButton("users", `用户 · ${profiles.length}`)}</nav>
      {notice ? <div role="status" style={{ margin: "-8px 0 14px", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--stroke)", background: "var(--bg-2)", color: notice.includes("失败") ? "#ff9a8a" : "var(--accent)", fontSize: 12.5 }}>{notice}</div> : null}
      {latestFeeImport ? <FeeImportSummary value={latestFeeImport} exceptions={feeExceptions} rate={usdToCnyRate} /> : null}

      {tab === "overview" ? <Overview cards={cards} byModel={byModel} byUserModel={byUserModel} profileById={profileById} rate={usdToCnyRate} usage={usage} chip={chip} /> : null}
      {tab === "attribution" ? <FeeAttributionPanel exceptions={feeExceptions} profiles={profiles} rate={usdToCnyRate} run={run} busy={busy} /> : null}
      {tab === "whitelist" ? <WhitelistPanel whitelist={whitelist} emailDraft={emailDraft} setEmailDraft={setEmailDraft} run={run} busy={busy} chip={chip} /> : null}
      {tab === "users" ? <UsersPanel profiles={profiles} byUser={byUser} budgetByUser={budgetByUser} budgetDrafts={budgetDrafts} setBudgetDrafts={setBudgetDrafts} monthStart={monthStart} rate={usdToCnyRate} run={run} busy={busy} meId={meId} isSuperadmin={isSuperadmin} /> : null}
    </main>
  </PageShell>;
}

function FeeImportSummary({ value, exceptions, rate }: { value: FeeImport; exceptions: FeeException[]; rate: number }) {
  const directUsd = numeric(value.ledger_matched_cost_usd);
  const creatorUsd = numeric(value.creator_recovered_cost_usd);
  const projectUsd = numeric(value.project_recovered_cost_usd);
  const automaticUsd = directUsd + creatorUsd + projectUsd;
  const attribution = summarizeWetokenFeeAttributions(exceptions.map((row) => ({
    classification: row.classification === "ambiguous" ? "ambiguous" : "unallocated_historical",
    actualCostUsd: numeric(row.actual_cost_usd),
    assignmentKind: feeExceptionAssignmentKind(row),
  })));
  const assignedUsd = automaticUsd + attribution.userCostUsd;
  const unallocatedBreakdown = feeExceptionModelBreakdown(exceptions);
  const accountedUsd = assignedUsd + attribution.companyCostUsd + attribution.pendingCostUsd;
  const invoiceUsd = numeric(value.imported_cost_usd);
  const varianceUsd = Math.abs(invoiceUsd - accountedUsd);
  return <section style={{ ...panelStyle, marginBottom: 16, borderColor: attribution.pendingCostUsd || varianceUsd > .0000001 ? "#a77d42" : "var(--stroke)" }}>
    <div className="fg-mono" style={sectionTitleStyle}>本月 WeToken 实际账单对账</div>
    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 9 }}>
      <div><small style={cardLabelStyle}>账单总消费</small><strong className="fg-mono" style={{ display: "block", marginTop: 4 }}>{money(invoiceUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{numeric(value.imported_count)} 笔</small></div>
      <div><small style={cardLabelStyle}>归属用户</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: "var(--accent)" }}>{money(assignedUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>自动 {money(automaticUsd, rate)} · 手动 {money(attribution.userCostUsd, rate)}</small></div>
      <div><small style={cardLabelStyle}>公司 / 共享成本</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: "#8fc8ff" }}>{money(attribution.companyCostUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{attribution.companyCount} 笔，未计入用户</small></div>
      <div><small style={cardLabelStyle}>待归属</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: attribution.pendingCostUsd ? "#e6b85c" : "var(--text)" }}>{money(attribution.pendingCostUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{attribution.pendingCount} 笔{attribution.pendingConflictCount ? `，其中冲突 ${attribution.pendingConflictCount} 笔` : ""}</small></div>
    </div>
    {unallocatedBreakdown.length ? <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--stroke)", color: "var(--text-2)", fontSize: 12 }}>待归属按模型：{unallocatedBreakdown.map((row) => `${row.model} ${row.count} 笔 ${money(row.costUsd, rate)}`).join("；")}</div> : null}
    <div style={{ marginTop: 9, color: varianceUsd > .0000001 ? "#ff9a8a" : "var(--text-3)", fontSize: 11 }}>最后导入：{new Date(value.created_at).toLocaleString("zh-CN")}。账单总额 = 用户归属 + 公司 / 共享成本 + 待归属{varianceUsd > .0000001 ? `；当前差额 ${money(varianceUsd, rate)}，请重新导入该月账单。` : "。"}</div>
  </section>;
}

type AttributionRun = (action: () => Promise<unknown>, success?: string) => Promise<void>;

function FeeAttributionPanel({ exceptions, profiles, rate, run, busy }: { exceptions: FeeException[]; profiles: Profile[]; rate: number; run: AttributionRun; busy: boolean }) {
  const [filter, setFilter] = useState<"pending" | "user" | "company" | "all">("pending");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchKind, setBatchKind] = useState<Exclude<WetokenFeeAssignmentKind, "pending">>("user");
  const [batchUserId, setBatchUserId] = useState("");
  const [batchUsageKind, setBatchUsageKind] = useState<"" | WetokenFeeUsageKind>("");
  const [batchNote, setBatchNote] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return exceptions.filter((row) => {
      const assignment = feeExceptionAssignmentKind(row);
      if (filter !== "all" && assignment !== filter) return false;
      if (!keyword) return true;
      return [row.reference_id, row.model || "", row.assignment_note || ""].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [exceptions, filter, query]);
  const visible = filtered.slice(0, 300);
  const selectedVisible = visible.filter((row) => selected.has(row.reference_id));
  const summary = useMemo(() => summarizeWetokenFeeAttributions(exceptions.map((row) => ({
    classification: row.classification === "ambiguous" ? "ambiguous" : "unallocated_historical",
    actualCostUsd: numeric(row.actual_cost_usd),
    assignmentKind: feeExceptionAssignmentKind(row),
  }))), [exceptions]);

  function toggle(referenceId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(referenceId)) next.delete(referenceId);
      else next.add(referenceId);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visible) next.add(row.reference_id);
      return next;
    });
  }

  async function applyBatch() {
    if (!selectedVisible.length) return { error: "请先勾选待归属账单" };
    if (selectedVisible.length > 100) return { error: "每次最多批量归属 100 笔；请缩小筛选范围后分批处理" };
    const results = await Promise.all(selectedVisible.map((row) => assignWetokenFeeAttribution(row.reference_id, {
      assignmentKind: batchKind,
      userId: batchUserId,
      usageKind: batchUsageKind || null,
      note: batchNote,
    })));
    const failed = results.find((result) => result && typeof result === "object" && "error" in result && typeof result.error === "string");
    if (failed && typeof failed === "object" && "error" in failed) return { error: `部分归属未保存：${String(failed.error)}` };
    setSelected(new Set());
    return { ok: true };
  }

  return <div>
    <section style={{ ...panelStyle, marginBottom: 14 }}>
      <div className="fg-mono" style={sectionTitleStyle}>待归属实际账单池</div>
      <p style={{ margin: "8px 0 12px", color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.55 }}>每笔都按 WeToken Reference ID 单独保存。归属给用户会写入该用户的实际费用记录；归属为公司 / 共享成本只计入团队账单，不会分摊给用户。所有操作会记录管理员、时间和说明。</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9 }}>
        <div><small style={cardLabelStyle}>待归属</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: "#e6b85c" }}>{money(summary.pendingCostUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{summary.pendingCount} 笔</small></div>
        <div><small style={cardLabelStyle}>已归属用户</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: "var(--accent)" }}>{money(summary.userCostUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{summary.userCount} 笔手动归属</small></div>
        <div><small style={cardLabelStyle}>公司 / 共享成本</small><strong className="fg-mono" style={{ display: "block", marginTop: 4, color: "#8fc8ff" }}>{money(summary.companyCostUsd, rate)}</strong><small style={{ color: "var(--text-3)" }}>{summary.companyCount} 笔</small></div>
      </div>
    </section>

    <section style={{ ...panelStyle, marginBottom: 14 }}>
      <div className="fg-mono" style={sectionTitleStyle}>批量归属已勾选账单</div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--text-2)", fontSize: 12 }}>{selectedVisible.length} 笔已勾选（单次最多 100 笔）</span>
        <select value={batchKind} onChange={(event) => setBatchKind(event.target.value as Exclude<WetokenFeeAssignmentKind, "pending">)} disabled={busy} style={inputStyle}><option value="user">归属到用户</option><option value="company">公司 / 共享成本</option></select>
        {batchKind === "user" ? <><select value={batchUserId} onChange={(event) => setBatchUserId(event.target.value)} disabled={busy} style={inputStyle}><option value="">选择用户</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.email}</option>)}</select><select value={batchUsageKind} onChange={(event) => setBatchUsageKind(event.target.value as "" | WetokenFeeUsageKind)} disabled={busy} style={inputStyle}><option value="">费用类型</option><option value="image">图片</option><option value="video">视频</option><option value="text">文本</option></select></> : null}
        <input value={batchNote} onChange={(event) => setBatchNote(event.target.value)} disabled={busy} placeholder="归属依据 / 备注（必填）" style={{ ...inputStyle, minWidth: 230, flex: 1 }} />
        <button disabled={busy || !selectedVisible.length} onClick={() => void run(applyBatch, "已批量保存费用归属")} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: "none", cursor: "pointer", color: "var(--accent-ink)", background: "var(--accent)", opacity: busy || !selectedVisible.length ? .5 : 1 }}>批量保存</button>
      </div>
    </section>

    <section style={{ ...panelStyle, overflow: "hidden", padding: 0 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--stroke)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong className="fg-mono" style={sectionTitleStyle}>逐笔归属</strong>
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} style={inputStyle}><option value="pending">仅待归属</option><option value="user">已归属用户</option><option value="company">公司 / 共享</option><option value="all">全部</option></select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Reference ID、模型或备注" style={{ ...inputStyle, minWidth: 250, flex: 1 }} />
        <button onClick={selectVisible} disabled={!visible.length} style={{ ...plainButton("var(--accent)"), opacity: visible.length ? 1 : .5 }}>勾选当前 {visible.length} 笔</button>
      </div>
      {filtered.length > visible.length ? <div style={{ padding: "9px 16px", color: "#e6b85c", fontSize: 12 }}>筛选结果有 {filtered.length} 笔；当前仅渲染前 {visible.length} 笔，请用搜索或状态缩小范围后处理。</div> : null}
      <div style={{ overflowX: "auto" }}>
        <div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 1120, gridTemplateColumns: ".38fr 1.4fr 1.55fr .72fr 1.45fr" }}><div>选择</div><div>Reference ID / 时间</div><div>模型 / 金额</div><div>状态</div><div>归属操作</div></div>
        {visible.length === 0 ? <div style={{ padding: 18, color: "var(--text-3)" }}>当前筛选下没有费用记录</div> : visible.map((row) => <FeeAttributionRow key={row.reference_id} exception={row} profiles={profiles} rate={rate} selected={selected.has(row.reference_id)} onToggle={() => toggle(row.reference_id)} run={run} busy={busy} />)}
      </div>
    </section>
  </div>;
}

function FeeAttributionRow({ exception, profiles, rate, selected, onToggle, run, busy }: { exception: FeeException; profiles: Profile[]; rate: number; selected: boolean; onToggle: () => void; run: AttributionRun; busy: boolean }) {
  const currentAssignment = feeExceptionAssignmentKind(exception);
  const [assignmentKind, setAssignmentKind] = useState<Exclude<WetokenFeeAssignmentKind, "pending">>(currentAssignment === "company" ? "company" : "user");
  const [userId, setUserId] = useState(exception.assigned_user_id || "");
  const [usageKind, setUsageKind] = useState<"" | WetokenFeeUsageKind>(exception.assigned_usage_kind || "");
  const [note, setNote] = useState(exception.assignment_note || "");
  const classificationLabel = exception.classification === "ambiguous" ? "任务 ID 冲突" : currentAssignment === "pending" ? "待归属" : currentAssignment === "user" ? "已归属用户" : "公司 / 共享";
  const classificationColor = exception.classification === "ambiguous" ? "#ff9a8a" : currentAssignment === "pending" ? "#e6b85c" : currentAssignment === "user" ? "var(--accent)" : "#8fc8ff";
  return <div style={{ ...tableRowStyle, minWidth: 1120, gridTemplateColumns: ".38fr 1.4fr 1.55fr .72fr 1.45fr", alignItems: "start" }}>
    <div><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择 ${exception.reference_id}`} /></div>
    <div style={{ minWidth: 0 }}><div className="fg-mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exception.reference_id}</div><div style={{ color: "var(--text-3)", fontSize: 10.5, marginTop: 4 }}>{exception.occurred_at ? new Date(exception.occurred_at).toLocaleString("zh-CN") : "账单未提供时间"}</div></div>
    <div style={{ minWidth: 0 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exception.model || "未提供模型名"}</div><div className="fg-mono" style={{ marginTop: 4 }}>{money(numeric(exception.actual_cost_usd), rate)}</div></div>
    <div>{<span style={{ color: classificationColor, fontSize: 11 }}>{classificationLabel}</span>}</div>
    <div style={{ display: "grid", gap: 7 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><select value={assignmentKind} onChange={(event) => setAssignmentKind(event.target.value as Exclude<WetokenFeeAssignmentKind, "pending">)} disabled={busy} style={{ ...inputStyle, height: 32 }}><option value="user">归属到用户</option><option value="company">公司 / 共享成本</option></select>{assignmentKind === "user" ? <><select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy} style={{ ...inputStyle, height: 32, maxWidth: 160 }}><option value="">选择用户</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.email}</option>)}</select><select value={usageKind} onChange={(event) => setUsageKind(event.target.value as "" | WetokenFeeUsageKind)} disabled={busy} style={{ ...inputStyle, height: 32 }}><option value="">类型</option><option value="image">图片</option><option value="video">视频</option><option value="text">文本</option></select></> : null}</div>
      <div style={{ display: "flex", gap: 6 }}><input value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} placeholder="归属依据 / 备注（必填）" style={{ ...inputStyle, height: 32, minWidth: 0, flex: 1 }} /><button disabled={busy} onClick={() => void run(() => assignWetokenFeeAttribution(exception.reference_id, { assignmentKind, userId, usageKind: usageKind || null, note }), "已保存费用归属")} style={{ height: 32, padding: "0 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--accent)", color: "var(--accent-ink)", opacity: busy ? .5 : 1 }}>保存</button></div>
    </div>
  </div>;
}

function Overview({ cards, byModel, byUserModel, profileById, rate, usage, chip }: { cards: string[][]; byModel: Record<string, UsageSummary>; byUserModel: UserModelGroup[]; profileById: Map<string, Profile>; rate: number; usage: Usage[]; chip: (label: string, color?: string) => JSX.Element }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(185px,1fr))", gap: 14 }}>
    {cards.map(([label, value]) => <section key={label} style={cardStyle}><div className="fg-mono" style={cardLabelStyle}>{label}</div><div className="fg-mono" style={{ marginTop: 7, fontSize: 18, fontWeight: 600 }}>{value}</div></section>)}
    <section style={{ ...panelStyle, gridColumn: "1 / -1" }}><div className="fg-mono" style={sectionTitleStyle}>按模型</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 9 }}>{Object.keys(byModel).length === 0 ? <p style={{ color: "var(--text-3)", margin: 0 }}>本月暂无调用</p> : Object.entries(byModel).map(([model, group]) => <div key={model} style={{ padding: "12px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)" }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{model}</strong><div className="fg-mono" style={{ marginTop: 6, color: "var(--text-3)", fontSize: 11 }}>{group.successfulCalls} 成功 · {group.failedCalls} 失败 · {group.successfulImages} 图 · {group.successfulVideoSeconds} 秒</div><div className="fg-mono" style={{ marginTop: 6, fontSize: 12 }}>实际 {money(group.confirmedCostUsd, rate)}</div></div>)}</div></section>
    <UsageGroups groups={byUserModel} profileById={profileById} rate={rate} />
    <section style={{ ...panelStyle, gridColumn: "1 / -1", overflow: "hidden", padding: 0 }}><div className="fg-mono" style={{ ...sectionTitleStyle, padding: "14px 18px", borderBottom: "1px solid var(--stroke)" }}>本月生成记录</div><div style={{ overflowX: "auto" }}><div className="fg-mono" style={tableHeaderStyle}><div>状态</div><div>模型 / 任务</div><div>用量</div><div>费用</div><div>时间</div></div>{usage.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>本月暂无生成记录</div> : usage.slice(0, 100).map((row) => <div key={row.id} style={tableRowStyle}><div>{chip(statusLabel(row.status), row.status === "failed" ? "#ff9a8a" : row.status === "succeeded" ? "var(--accent)" : "#e6b85c")}</div><div style={{ minWidth: 0 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.model || "未知模型"}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{row.provider_request_id || row.request_id || row.id}</div></div><div className="fg-mono" style={{ color: "var(--text-2)", fontSize: 11 }}>{unitLabel(row)}</div><div className="fg-mono" style={{ color: row.status === "failed" ? "#ff9a8a" : "var(--text)", fontSize: 11 }}>{rowCost(row, rate)}</div><div className="fg-mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>{new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div></div>)}</div></section>
  </div>;
}

function UsageGroups({ groups, profileById, rate }: { groups: UserModelGroup[]; profileById: Map<string, Profile>; rate: number }) {
  return <section style={{ ...panelStyle, gridColumn: "1 / -1", overflow: "hidden", padding: 0 }}><div className="fg-mono" style={{ ...sectionTitleStyle, padding: "14px 18px", borderBottom: "1px solid var(--stroke)" }}>按用户 × 模型</div><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 880, gridTemplateColumns: "1.7fr 1.6fr .8fr 1fr 1fr" }}><div>用户</div><div>模型</div><div>成功 / 失败</div><div>图片 / 视频</div><div>实际费用</div></div>{groups.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>本月暂无用量</div> : groups.map(({ userId, model, group }) => <div key={`${userId}:${model}`} style={{ ...tableRowStyle, minWidth: 880, gridTemplateColumns: "1.7fr 1.6fr .8fr 1fr 1fr" }}><div>{profileById.get(userId)?.email || userId}</div><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div><div>{group.successfulCalls} / {group.failedCalls}</div><div>{group.successfulImages} 图 · {group.successfulVideoSeconds} 秒</div><div className="fg-mono">{money(group.confirmedCostUsd, rate)}</div></div>)}</div></section>;
}

function WhitelistPanel({ whitelist, emailDraft, setEmailDraft, run, busy, chip }: { whitelist: Whitelist[]; emailDraft: string; setEmailDraft: (value: string) => void; run: (action: () => Promise<unknown>, success?: string) => Promise<void>; busy: boolean; chip: (label: string, color?: string) => JSX.Element }) {
  return <div><div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, ...panelStyle, marginBottom: 14 }}><div style={{ flex: 1, minWidth: 240 }}><div className="fg-mono" style={{ ...cardLabelStyle, marginBottom: 6 }}>添加白名单邮箱</div><input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} placeholder="someone@beva.com" style={{ ...inputStyle, width: "100%" }} /></div><Hov as="button" disabled={busy || !emailDraft.trim()} onClick={() => run(async () => { await addWhitelist(emailDraft); setEmailDraft(""); })} base={{ height: 36, padding: "0 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: busy || !emailDraft.trim() ? .5 : 1 }} hover={{ filter: "brightness(1.08)" }}>添加并批准</Hov></div><section style={{ ...panelStyle, overflow: "hidden", padding: 0 }}><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 700, gridTemplateColumns: "2fr 1fr 1fr 1.3fr" }}><div>邮箱</div><div>状态</div><div>申请时间</div><div style={{ textAlign: "right" }}>操作</div></div>{whitelist.length === 0 ? <div style={{ padding: 16, color: "var(--text-3)" }}>暂无白名单记录</div> : whitelist.map((item) => <div key={item.id} style={{ ...tableRowStyle, minWidth: 700, gridTemplateColumns: "2fr 1fr 1fr 1.3fr" }}><div>{item.email}</div><div>{chip(item.status, item.status === "approved" ? "var(--accent)" : item.status === "rejected" ? "#ff9a8a" : "#e6b85c")}</div><div>{new Date(item.requested_at).toLocaleDateString("zh-CN")}</div><div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>{item.status !== "approved" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "approved"))} style={plainButton("var(--accent)")}>批准</button> : null}{item.status !== "rejected" ? <button onClick={() => run(() => setWhitelistStatus(item.id, "rejected"))} style={plainButton("var(--text-3)")}>拒绝</button> : null}<button onClick={() => run(() => deleteWhitelist(item.id))} style={plainButton("#ff9a8a")}>删除</button></div></div>)}</div></section></div>;
}

function UsersPanel({ profiles, byUser, budgetByUser, budgetDrafts, setBudgetDrafts, monthStart, rate, run, busy, meId, isSuperadmin }: { profiles: Profile[]; byUser: Record<string, UsageSummary>; budgetByUser: Map<string, Budget>; budgetDrafts: Record<string, string>; setBudgetDrafts: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void; monthStart: string; rate: number; run: (action: () => Promise<unknown>, success?: string) => Promise<void>; busy: boolean; meId: string; isSuperadmin: boolean }) {
  return <div><p style={{ margin: "0 0 12px", color: "var(--text-3)", fontSize: 12.5 }}>月额度使用人民币设置。实际费用只统计已匹配的 WeToken 费用流水；提交生成时系统会先临时锁定额度，失败后自动释放。</p><section style={{ ...panelStyle, overflow: "hidden", padding: 0 }}><div style={{ overflowX: "auto" }}><div className="fg-mono" style={{ ...tableHeaderStyle, minWidth: 1060, gridTemplateColumns: "2fr 1fr 1.25fr 1.8fr 1fr" }}><div>用户</div><div>成功 / 失败</div><div>实际费用</div><div>月额度（人民币）</div><div>平台角色</div></div>{profiles.map((profile) => { const group = byUser[profile.id] || emptyUsageSummary(); const budget = budgetByUser.get(profile.id); const limitCny = budget ? numeric(budget.limit_usd) * rate : null; return <div key={profile.id} style={{ ...tableRowStyle, minWidth: 1060, gridTemplateColumns: "2fr 1fr 1.25fr 1.8fr 1fr", alignItems: "center" }}><div>{profile.email}{profile.id === meId ? <small style={{ marginLeft: 7, color: "var(--accent)" }}>你</small> : null}</div><div>{group.successfulCalls} / {group.failedCalls}</div><div className="fg-mono">{money(group.confirmedCostUsd, rate)}</div><div style={{ display: "flex", gap: 7, alignItems: "center" }}><input value={budgetDrafts[profile.id] ?? ""} onChange={(event) => setBudgetDrafts((current) => ({ ...current, [profile.id]: event.target.value }))} inputMode="decimal" placeholder="不限额" disabled={busy} style={{ ...inputStyle, width: 100 }} /><button disabled={busy} onClick={() => run(() => setMonthlyBudget(profile.id, monthStart, budgetDrafts[profile.id] ?? ""))} style={{ height: 34, padding: "0 10px", borderRadius: 9, border: "none", color: "var(--accent-ink)", background: "var(--accent)", cursor: "pointer", opacity: busy ? .5 : 1 }}>保存</button><span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{limitCny === null ? "不限额" : `上限 ¥${limitCny.toFixed(2)}`}</span></div><select defaultValue={profile.platform_role} disabled={busy || profile.id === meId || (!isSuperadmin && profile.platform_role === "superadmin")} onChange={(event) => run(() => setUserRole(profile.id, event.target.value as "user" | "admin" | "superadmin"))} style={{ borderRadius: 8, border: "1px solid var(--stroke)", background: "var(--panel-solid)", color: "var(--text)", padding: "6px 8px" }}><option value="user">user</option><option value="admin">admin</option>{isSuperadmin ? <option value="superadmin">superadmin</option> : null}</select></div>; })}</div></section></div>;
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
