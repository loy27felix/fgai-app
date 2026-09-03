import Link from "next/link";
import type { ReactNode } from "react";
import type { getLiveTodayReport, getReportDetails, ReportRunRecord } from "@/lib/observability/reporting";

type ReportDetails = NonNullable<Awaited<ReturnType<typeof getReportDetails>>>;
type LiveTodayDetails = NonNullable<Awaited<ReturnType<typeof getLiveTodayReport>>>;
type ReportType = ReportRunRecord["report_type"];
type ReportStatusTone = "final" | "draft" | "failed" | "running";

type AccountSnapshot = {
  userId: string;
  accountEmail: string;
  activityKind: string;
  usageCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  imageCount: number;
  videoSeconds: number;
  confirmedCostUsd: number;
  estimatedCostUsd: number;
  reservedCostUsd: number;
  unknownCostCalls: number;
  errorCount: number;
};

type ErrorSnapshot = {
  source: string;
  service: string;
  severity: string;
  impact: string;
  code: string | null;
  message: string;
  first_occurred_at: string | null;
  last_occurred_at: string | null;
  occurrences: number | string;
  affected_accounts: number | string;
  affected_requests: number | string;
  affected_tasks?: number | string;
  sample_trace_id?: string | null;
  sample?: unknown;
  affected_account_emails?: string[] | null;
  metadata?: unknown;
};

type ServiceSnapshot = {
  service: string;
  check_count: number | string;
  healthy_checks: number | string;
  unhealthy_checks: number | string;
  incident_count: number | string;
  observed_seconds: number | string;
  unhealthy_seconds: number | string;
  availability_ratio: number | string | null;
  data_complete: boolean;
  first_observed_at: string | null;
  last_observed_at: string | null;
};

type Summary = {
  accounts?: { active?: number; aiActive?: number; sessionOnly?: number };
  usage?: { calls?: number; successfulCalls?: number; failedCalls?: number; totalTokens?: number; imageCount?: number; videoSeconds?: number };
  costs?: { confirmedUsd?: number; estimatedUsd?: number; reservedUsd?: number; unknownCostCalls?: number; cnyRate?: number; confirmedCny?: number; estimatedCny?: number; reservedCny?: number };
  errors?: { fingerprints?: number; occurrences?: number; affectedAccounts?: number; blocked?: number; degraded?: number; unknown?: number };
  services?: { monitored?: number; complete?: number; incidents?: number };
};

const REPORT_TYPES: ReportType[] = ["daily", "weekly", "monthly"];
const REPORT_META: Record<ReportType, { label: string; kicker: string }> = {
  daily: { label: "日报", kicker: "DAILY" },
  weekly: { label: "周报", kicker: "WEEKLY" },
  monthly: { label: "月报", kicker: "MONTHLY" },
};
const ERROR_GRID = "1.05fr 1.05fr .72fr 1fr 1.75fr 1.15fr 2fr";
const ERROR_SOURCE_LABELS: Record<string, string> = {
  frontend: "浏览器",
  app: "应用",
  provider: "供应商",
  infra: "基础设施",
  deploy: "部署",
  billing: "计费",
  data: "数据",
};

const numeric = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const integer = (value: unknown) => Math.trunc(numeric(value)).toLocaleString("zh-CN");

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactDate(value: string | null | undefined) {
  if (!value) return "日期待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期待定";
  return date.toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, ".");
}

function reportPeriod(run: ReportRunRecord) {
  return dateText(run.period_start) + " — " + dateText(run.period_end);
}

function compactReportPeriod(run: ReportRunRecord) {
  return compactDate(run.period_start) + " — " + compactDate(run.period_end);
}

function statusLabel(run: ReportRunRecord) {
  if (run.status === "succeeded") return run.is_final ? "最终版" : "临时版";
  if (run.status === "running") return "生成中";
  return "失败待重试";
}

function statusTone(run: ReportRunRecord): ReportStatusTone {
  if (run.status === "failed") return "failed";
  if (run.status === "running") return "running";
  return run.is_final ? "final" : "draft";
}

function activityLabel(value: string) {
  if (value === "session_only") return "仅访问";
  if (value === "ai_and_session") return "AI + 访问";
  return "AI 使用";
}

function impactTone(value: string) {
  if (value === "blocked") return "is-blocked";
  if (value === "degraded") return "is-degraded";
  return "is-neutral";
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function errorAccountEmails(item: ErrorSnapshot) {
  const direct = stringValues(item.affected_account_emails);
  if (direct.length) return direct;
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : null;
  return stringValues(metadata?.affectedAccountEmails);
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorSample(item: ErrorSnapshot) {
  return recordValue(item.sample) || recordValue(recordValue(item.metadata)?.sample);
}

function sampleValue(sample: Record<string, unknown> | null, keys: string[]) {
  if (!sample) return null;
  for (const key of keys) {
    const value = sample[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function sampleText(sample: Record<string, unknown> | null, keys: string[]) {
  const value = sampleValue(sample, keys);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function sampleDisplay(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2) || "";
  } catch {
    return "无法展示该上下文";
  }
}

function sourceLabel(value: string) {
  return ERROR_SOURCE_LABELS[value] || value;
}

function isoText(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function errorLogHref(run: ReportRunRecord, item: ErrorSnapshot) {
  const sample = errorSample(item);
  const lookup = sampleText(sample, ["eventId", "traceId", "requestId", "taskId"])
    || item.sample_trace_id
    || item.code
    || item.message;
  const params = new URLSearchParams();
  const from = isoText(run.period_start);
  const to = isoText(run.period_end);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (lookup) params.set("q", lookup);
  return "/admin/logs?" + params.toString();
}

function SampleField({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  const display = sampleDisplay(value);
  if (!display) return null;
  return <div><dt>{label}</dt><dd className={mono ? "fg-mono" : ""} title={display}>{display}</dd></div>;
}

function SampleData({ label, value }: { label: string; value: unknown }) {
  const display = sampleDisplay(value);
  if (!display) return null;
  return <div className="observability-error-chain__data"><span className="fg-mono">{label}</span><pre>{display}</pre></div>;
}

function ErrorChain({ run, item, accountCount }: { run: ReportRunRecord; item: ErrorSnapshot; accountCount: number }) {
  const sample = errorSample(item);
  const actor = sampleText(sample, ["actorEmail", "actorId"]) || (accountCount ? "受影响账户" : "未关联账户");
  const sampleTime = sampleText(sample, ["occurredAt"]) || item.last_occurred_at;
  const feature = sampleText(sample, ["feature"]) || item.service;
  const action = sampleText(sample, ["action", "stage", "outcome"]);
  return <div className="observability-error-chain">
    <div className="observability-error-chain__top">
      <strong title={actor}>{actor}</strong>
      <Link href={errorLogHref(run, item)} className="observability-error-chain__link">查看日志</Link>
    </div>
    <div className="observability-error-chain__meta"><span>{dateText(sampleTime)}</span><span title={feature}>{feature}</span>{action ? <span title={action}>{action}</span> : null}</div>
    <details className="observability-error-chain__details">
      <summary><span>展开失败上下文</span><b>链路</b></summary>
      <dl>
        <SampleField label="主体" value={sampleValue(sample, ["actorEmail", "actorId"]) || (accountCount ? "受影响账户" : "未关联账户")} />
        <SampleField label="发生时间" value={sampleTime} mono />
        <SampleField label="功能" value={sampleValue(sample, ["feature"]) || item.service} />
        <SampleField label="动作" value={sampleValue(sample, ["action"])} />
        <SampleField label="阶段" value={sampleValue(sample, ["stage"])} />
        <SampleField label="结果" value={sampleValue(sample, ["outcome"])} />
        <SampleField label="Route" value={sampleValue(sample, ["route"])} mono />
        <SampleField label="Trace ID" value={sampleValue(sample, ["traceId"]) || item.sample_trace_id} mono />
        <SampleField label="Request ID" value={sampleValue(sample, ["requestId"])} mono />
        <SampleField label="Task ID" value={sampleValue(sample, ["taskId"])} mono />
      </dl>
      <SampleData label="Parameters / 执行参数" value={sampleValue(sample, ["parameters"])} />
      <SampleData label="Data / 业务数据" value={sampleValue(sample, ["data"])} />
      <SampleData label="Metadata / 附加元数据" value={sampleValue(sample, ["metadata"])} />
      <SampleData label="Stack / 原始堆栈" value={sampleValue(sample, ["stack"])} />
    </details>
  </div>;
}

function percentage(value: number | string | null) {
  if (value === null) return "—";
  return (numeric(value) * 100).toFixed(2) + "%";
}

function money(usd: unknown, rate: number) {
  const amount = numeric(usd);
  return "$" + amount.toFixed(4) + " · ¥" + (amount * rate).toFixed(2);
}

function latestRun(runs: ReportRunRecord[], reportType: ReportType) {
  return runs.find((run) => run.report_type === reportType) || null;
}

function reportHref(run: ReportRunRecord, query: string) {
  const params = run.id === "live-today"
    ? new URLSearchParams({ view: "today" })
    : new URLSearchParams({ id: run.id });
  if (query) {
    params.set("q", query);
  }
  return "/admin/reports?" + params.toString();
}

function deploymentVersion(run: ReportRunRecord) {
  const value = run.summary && typeof run.summary === "object" ? run.summary.deploymentVersion : null;
  return typeof value === "string" && value ? value : "unknown";
}

function metric(label: string, value: string, detail?: string) {
  return <div key={label} className="observability-metric">
    <div className="fg-mono observability-metric__label">{label}</div>
    <div className="fg-mono observability-metric__value">{value}</div>
    {detail ? <div className="observability-metric__detail">{detail}</div> : null}
  </div>;
}

function ReportSelector({ runs, selectedRun, liveToday, isLiveToday, query }: { runs: ReportRunRecord[]; selectedRun: ReportRunRecord | null; liveToday: LiveTodayDetails | null; isLiveToday: boolean; query: string }) {
  const selectedType = selectedRun?.report_type;
  const selectedRuns = selectedType ? runs.filter((run) => run.report_type === selectedType) : [];
  const selectedMeta = selectedType ? REPORT_META[selectedType] : null;

  return <section className="observability-report__selector" aria-label="报表周期与版本选择">
    {liveToday ? <Link href="/admin/reports?view=today" className={"observability-live-card" + (isLiveToday ? " is-active" : "")} aria-current={isLiveToday ? "page" : undefined}>
      <div>
        <span className="fg-mono observability-kicker">LIVE / TODAY</span>
        <strong>今日实时</strong>
        <span>{compactDate(liveToday.run.period_start)} — 数据截至 {dateText(liveToday.run.data_as_of)}</span>
      </div>
      <span className="fg-mono observability-live-card__status"><i aria-hidden="true" />实时读取 · 刷新页面更新</span>
    </Link> : null}
    <div className="observability-selector__intro">
      <span className="fg-mono observability-kicker">{isLiveToday ? "LIVE ACTIVE" : "REPORT DESK"}</span>
      <strong>{isLiveToday ? "当前选择" : selectedRun && selectedMeta ? selectedMeta.label + " · " + statusLabel(selectedRun) : "选择一份报表"}</strong>
      <span>{isLiveToday && selectedRun ? "今日 00:00 — 数据截至 " + dateText(selectedRun.data_as_of) : selectedRun ? compactReportPeriod(selectedRun) : "从周期入口查看明细"}</span>
    </div>

    <nav className="observability-period-nav" aria-label="报表周期">
      {REPORT_TYPES.map((reportType) => {
        const run = latestRun(runs, reportType);
        const meta = REPORT_META[reportType];
        const isActive = !isLiveToday && selectedType === reportType;
        if (!run) {
          return <div key={reportType} className="observability-period-tab is-empty" aria-disabled="true">
            <span className="fg-mono observability-period-tab__kicker">{meta.kicker}</span>
            <strong>{meta.label}</strong>
            <span className="observability-period-tab__period">暂无数据</span>
          </div>;
        }
        return <Link key={reportType} href={"/admin/reports?id=" + run.id} className={"observability-period-tab observability-period-tab--" + statusTone(run) + (isActive ? " is-active" : "")} aria-current={isActive ? "page" : undefined}>
          <span className="fg-mono observability-period-tab__kicker">{meta.kicker}</span>
          <strong>{meta.label}</strong>
          <span className="observability-period-tab__period">{compactReportPeriod(run)}</span>
          <span className="fg-mono observability-status-line"><i aria-hidden="true" />{statusLabel(run)} · r{run.revision}</span>
        </Link>;
      })}
    </nav>

    {selectedRun && selectedMeta ? <details key={"history-" + selectedRun.id + "-" + query + (isLiveToday ? "-live" : "-history")} className="observability-history" open={Boolean(query)}>
      <summary>
        <span><span className="fg-mono observability-kicker">HISTORY</span>历史版本</span>
        <span className="fg-mono observability-history__count">{query ? selectedRuns.length + " 条结果" : selectedRuns.length + " 条"} <b aria-hidden="true">⌄</b></span>
      </summary>
      <div className="observability-history__popover">
        <form action="/admin/reports" method="get" className="observability-history__search">
          <label htmlFor="observability-report-search">快速查找版本</label>
          <div className="observability-history__search-row">
            <input id="observability-report-search" name="q" type="search" defaultValue={query} placeholder="日期 / r1 / 最终版" maxLength={80} />
            <button type="submit">查找</button>
          </div>
          {query ? <Link href={reportHref(selectedRun, "")} className="observability-history__clear">清除筛选</Link> : <span className="observability-history__hint">支持日期、版本号和状态</span>}
        </form>
        <div className="observability-history__heading">
          <span>{selectedMeta.label}版本</span>
          <span className="fg-mono">{query ? "筛选结果" : "按周期倒序"}</span>
        </div>
        <div className="observability-history__list">
          {selectedRuns.length === 0 ? <div className="observability-history__no-result">没有匹配的版本，请换一个日期或状态。</div> : selectedRuns.map((run) => <Link key={run.id} href={reportHref(run, "")} className={"observability-history__item observability-history__item--" + statusTone(run) + (selectedRun.id === run.id ? " is-active" : "")} aria-current={selectedRun.id === run.id ? "page" : undefined}>
            <span className="fg-mono observability-history__revision">r{run.revision}</span>
            <span className="observability-history__period">{compactReportPeriod(run)}</span>
            <span className="fg-mono">{statusLabel(run)}</span>
          </Link>)}
        </div>
      </div>
    </details> : null}
  </section>;
}

function DataPanel({ eyebrow, title, count, children }: { eyebrow: string; title: string; count: string; children: ReactNode }) {
  return <section className="observability-data-panel">
    <div className="observability-data-panel__heading">
      <div>
        <span className="fg-mono observability-kicker">{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <span className="fg-mono observability-data-panel__count">{count}</span>
    </div>
    {children}
  </section>;
}

export default function ObservabilityReportView({ runs, detail, liveToday, error, query = "" }: { runs: ReportRunRecord[]; detail: ReportDetails | LiveTodayDetails | null; liveToday?: LiveTodayDetails | null; error?: string; query?: string }) {
  const summary = (detail?.run.summary || {}) as Summary;
  const rate = numeric(summary.costs?.cnyRate);
  const accounts = (detail?.accounts || []) as AccountSnapshot[];
  const errors = (detail?.errors || []) as ErrorSnapshot[];
  const services = (detail?.services || []) as ServiceSnapshot[];
  const selectedMeta = detail ? REPORT_META[detail.run.report_type] : null;
  const isLiveToday = detail?.run.id === "live-today";
  const selectedTone = detail ? (isLiveToday ? "running" : statusTone(detail.run)) : null;

  return <main className="observability-report">
    <header className="observability-report__header">
      <div>
        <span className="fg-mono observability-kicker">FG STUDIO / OPERATIONS</span>
        <h1>服务监控报表</h1>
        <p>日报、周报、月报按上海时区生成；当前报表优先展示，历史版本收纳在版本菜单内。</p>
      </div>
      <div className="observability-report__actions">
        <Link href="/admin/logs" className="observability-report__logs">日志检索</Link>
        <Link href="/admin" className="observability-report__back">返回管理后台</Link>
      </div>
    </header>

    {error ? <div className="observability-report__alert" role="alert">{error}</div> : null}

    {runs.length === 0 && !liveToday ? <section className="observability-report__empty">
      <span className="fg-mono observability-kicker">NO REPORT RUNS</span>
      <h2>暂无报表</h2>
      <p>scheduler 首次运行后会自动生成日报、周报和月报。</p>
    </section> : <>
      <ReportSelector runs={runs} selectedRun={detail?.run || null} liveToday={liveToday || null} isLiveToday={isLiveToday} query={query} />

      {!detail ? <section className="observability-report__empty">
        <span className="fg-mono observability-kicker">SELECT A REPORT</span>
        <h2>选择一份报表</h2>
        <p>从上方周期入口打开账户、错误和服务明细。</p>
      </section> : detail.run.status !== "succeeded" ? <section className="observability-report__empty observability-report__empty--warning">
        <span className="fg-mono observability-kicker">REPORT NOT READY</span>
        <h2>该报表尚未成功生成</h2>
        <p>{detail.run.error || "scheduler 会自动重试失败任务。"}</p>
      </section> : <>
        <section className="observability-report__hero">
          <div className="observability-report__hero-top">
            <div>
              <span className="fg-mono observability-kicker">{isLiveToday ? "LIVE / TODAY" : selectedMeta?.kicker + " / REVISION R" + detail.run.revision}</span>
              <h2>{isLiveToday ? "今日实时汇总" : <>{selectedMeta?.label} <span>·</span> {detail.run.is_final ? "最终版" : "临时版"}</>}</h2>
              <p>周期：{reportPeriod(detail.run)}；数据截至：{dateText(detail.run.data_as_of)}{isLiveToday ? "；只读实时汇总，刷新页面更新" : ""}</p>
            </div>
            <div className={"observability-report__state observability-report__state--" + selectedTone}>
              <i aria-hidden="true" />
              <span>{isLiveToday ? "实时读取 · 刷新页面更新" : detail.run.is_final ? "数据已结算" : "等待迟到任务和费用补齐"}</span>
            </div>
          </div>
          <div className="observability-report__meta">
            <div><span>部署版本</span><strong className="fg-mono">{deploymentVersion(detail.run)}</strong></div>
            <div><span>报表架构</span><strong className="fg-mono">schema v{detail.run.schema_version}</strong></div>
            <div><span>{isLiveToday ? "读取时间" : "生成时间"}</span><strong className="fg-mono">{dateText(detail.run.updated_at)}</strong></div>
          </div>
          <div className="observability-metric-grid">
            {metric("活跃账户", integer(summary.accounts?.active), "AI " + integer(summary.accounts?.aiActive) + " · 仅访问 " + integer(summary.accounts?.sessionOnly))}
            {metric("调用次数", integer(summary.usage?.calls), "成功 " + integer(summary.usage?.successfulCalls) + " · 失败 " + integer(summary.usage?.failedCalls))}
            {metric("Token", integer(summary.usage?.totalTokens), "图片 " + integer(summary.usage?.imageCount) + " · 视频 " + numeric(summary.usage?.videoSeconds).toFixed(1) + " 秒")}
            {metric("确认成本", money(summary.costs?.confirmedUsd, rate), "¥" + numeric(summary.costs?.confirmedCny).toFixed(2) + " · 已确认供应商金额")}
            {metric("估算成本", money(summary.costs?.estimatedUsd, rate), "¥" + numeric(summary.costs?.estimatedCny).toFixed(2) + " · 价格表估算")}
            {metric("风险预留", money(summary.costs?.reservedUsd, rate), "未知成本调用 " + integer(summary.costs?.unknownCostCalls))}
            {metric("错误事件", integer(summary.errors?.occurrences), "错误类型 " + integer(summary.errors?.fingerprints) + " · 影响账户 " + integer(summary.errors?.affectedAccounts))}
            {metric("服务可用性", integer(summary.services?.complete) + " / " + integer(summary.services?.monitored), "事件 " + integer(summary.services?.incidents) + " · 仅对完整观测计算比例")}
          </div>
        </section>

        <DataPanel eyebrow="ACCOUNT LEDGER" title="按账户汇总" count={accounts.length + " 个账户"}>
          <div className="observability-table-scroll"><div className="fg-mono observability-table__header" style={{ gridTemplateColumns: "2fr .9fr .9fr 1.1fr 1.3fr 1.2fr 1.2fr .7fr" }}><div>账户</div><div>活动</div><div>调用</div><div>Token</div><div>图片 / 视频</div><div>成本</div><div>预留 / 未知</div><div>错误</div></div>
            {accounts.length === 0 ? <div className="observability-table__empty">周期内暂无账户活动</div> : accounts.map((account) => <div key={account.userId} className="observability-table__row" style={{ gridTemplateColumns: "2fr .9fr .9fr 1.1fr 1.3fr 1.2fr 1.2fr .7fr" }}>
              <div className="observability-nowrap">{account.accountEmail}</div>
              <div>{activityLabel(account.activityKind)}</div>
              <div>{integer(account.usageCalls)}<small>成功 {integer(account.successfulCalls)} / 失败 {integer(account.failedCalls)}</small></div>
              <div className="fg-mono">{integer(account.totalTokens)}</div>
              <div>{integer(account.imageCount)} 张<small>{numeric(account.videoSeconds).toFixed(1)} 秒</small></div>
              <div className="fg-mono">{money(account.confirmedCostUsd, rate)}<small>估算 {money(account.estimatedCostUsd, rate)}</small></div>
              <div className="fg-mono">{money(account.reservedCostUsd, rate)}<small>未知 {integer(account.unknownCostCalls)}</small></div>
              <div className={numeric(account.errorCount) ? "observability-danger" : "observability-muted"}>{integer(account.errorCount)}</div>
            </div>)}
          </div>
        </DataPanel>

        <DataPanel eyebrow="ERROR IMPACT" title="错误与影响" count={errors.length + " 类错误"}>
          <div className="observability-table-scroll"><div className="fg-mono observability-table__header" style={{ gridTemplateColumns: ERROR_GRID }}><div>来源 / 服务</div><div>级别 / 影响</div><div>次数</div><div>影响人</div><div>失败链路</div><div>首次 / 末次</div><div>错误信息</div></div>
            {errors.length === 0 ? <div className="observability-table__empty">周期内没有归档错误事件</div> : errors.map((item, index) => {
              const message = item.message || "未提供错误信息";
              const accountEmails = errorAccountEmails(item);
              const accountCount = numeric(item.affected_accounts);
              return <div key={item.source + ":" + item.service + ":" + (item.code || "error") + ":" + index} className="observability-table__row" style={{ gridTemplateColumns: ERROR_GRID }}>
                <div><strong>{sourceLabel(item.source)}</strong><small>{item.service}</small></div>
                <div><span className={"observability-error-level " + impactTone(item.impact)}>{item.severity}</span><small className={"observability-impact " + impactTone(item.impact)}>{item.impact}</small></div>
                <div className="fg-mono">{integer(item.occurrences)}<small>请求 {integer(item.affected_requests)}</small></div>
                <div className="fg-mono observability-impact-people"><strong>{integer(item.affected_accounts)} 人</strong>
                  {accountEmails.length > 2 ? <details className="observability-impact-people__details">
                    <summary title={accountEmails.join("、")}><span>{accountEmails.slice(0, 2).join("、")} 等 {integer(accountCount)} 人</span><b>查看</b></summary>
                    <div>{accountEmails.map((email) => <span key={email}>{email}</span>)}</div>
                  </details> : accountEmails.length ? <small title={accountEmails.join("、")}>{accountEmails.join("、")}</small> : <small>{accountCount > 0 ? "账户明细未记录" : "未关联账户"}</small>}
                </div>
                <ErrorChain run={detail.run} item={item} accountCount={accountCount} />
                <div className="fg-mono observability-table__timestamp">{dateText(item.first_occurred_at)}<br />{dateText(item.last_occurred_at)}</div>
                <div className="observability-message">
                  <details className="observability-message__details">
                    <summary className="observability-message__summary" title={message}><span>{message}</span><b>展开</b></summary>
                    <div className="observability-message__full">{message}</div>
                  </details>
                  <small className="fg-mono">{item.code || "未分类"}</small>
                </div>
              </div>;
            })}
          </div>
        </DataPanel>

        <DataPanel eyebrow="SERVICE HEALTH" title="服务健康与监控完整度" count={services.length + " 项服务"}>
          <div className="observability-table-scroll"><div className="fg-mono observability-table__header" style={{ gridTemplateColumns: "1.45fr .82fr .86fr 1fr 1fr 1.75fr 1.25fr" }}><div>服务</div><div>可用率</div><div>检查次数</div><div>健康 / 异常</div><div>异常时长</div><div>观测时间</div><div>数据完整</div></div>
            {services.length === 0 ? <div className="observability-table__empty">周期内没有服务健康事件</div> : services.map((item) => <div key={item.service} className="observability-table__row" style={{ gridTemplateColumns: "1.45fr .82fr .86fr 1fr 1fr 1.75fr 1.25fr" }}>
              <div>{item.service}<small>观测 {numeric(item.observed_seconds).toFixed(0)} 秒</small></div>
              <div className={"fg-mono " + (item.data_complete ? "observability-success" : "observability-warning")}>{percentage(item.availability_ratio)}</div>
              <div className="fg-mono">{integer(item.check_count)}<small>事件 {integer(item.incident_count)}</small></div>
              <div>{integer(item.healthy_checks)} / {integer(item.unhealthy_checks)}</div>
              <div className="fg-mono">{numeric(item.unhealthy_seconds).toFixed(0)} 秒</div>
              <div className="fg-mono observability-table__timestamp"><span>首：{dateText(item.first_observed_at)}</span><span>末：{dateText(item.last_observed_at)}</span></div>
              <div className={item.data_complete ? "observability-success" : "observability-warning"}>{item.data_complete ? "完整" : "不完整，勿作可用性结论"}</div>
            </div>)}
          </div>
        </DataPanel>
      </>}
    </>}
  </main>;
}
