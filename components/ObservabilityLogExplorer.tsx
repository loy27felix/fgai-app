"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { DatePicker } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import { Icon } from "@/components/studio/ui";
import type {
  LogExplorerResult,
  LogLevel,
  LogLevelFilter,
  LogRecord,
  LogSourceFilter,
} from "@/lib/observability/log-query";

type Preset = "15m" | "1h" | "6h" | "24h" | "7d" | "3m";
type ActivePreset = Preset | "custom";
type ExplorerProps = { initialData: LogExplorerResult | null; initialError: string };
const PAGE_SIZES = [50, 100, 200] as const;
const MAX_RANGE_MONTHS = 3;
const DISPLAY_TIMEZONE = "Asia/Shanghai";

const PRESETS: Array<{ key: Preset; label: string; milliseconds?: number; months?: number }> = [
  { key: "15m", label: "近 15 分钟", milliseconds: 15 * 60 * 1_000 },
  { key: "1h", label: "近 1 小时", milliseconds: 60 * 60 * 1_000 },
  { key: "6h", label: "近 6 小时", milliseconds: 6 * 60 * 60 * 1_000 },
  { key: "24h", label: "近 24 小时", milliseconds: 24 * 60 * 60 * 1_000 },
  { key: "7d", label: "近 7 天", milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  { key: "3m", label: "近 3 个月", months: MAX_RANGE_MONTHS },
];

const SOURCE_OPTIONS: Array<{ value: LogSourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "audit", label: "业务审计" },
  { value: "app", label: "应用" },
  { value: "frontend", label: "浏览器" },
  { value: "provider", label: "供应商" },
  { value: "infra", label: "基础设施" },
  { value: "deploy", label: "部署" },
  { value: "billing", label: "计费" },
  { value: "data", label: "数据" },
];

const LEVEL_OPTIONS: Array<{ value: LogLevelFilter; label: string }> = [
  { value: "all", label: "全部级别" },
  { value: "critical", label: "Critical" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const LEVEL_META: Record<LogLevel, { label: string; className: string }> = {
  info: { label: "INFO", className: "is-info" },
  warning: { label: "WARN", className: "is-warning" },
  error: { label: "ERROR", className: "is-error" },
  critical: { label: "CRITICAL", className: "is-critical" },
};

const SOURCE_LABELS: Record<string, string> = {
  audit: "业务审计",
  frontend: "浏览器",
  app: "应用",
  provider: "供应商",
  infra: "基础设施",
  deploy: "部署",
  billing: "计费",
  data: "数据",
};

const EMPTY_SUMMARY = { total: 0, info: 0, warning: 0, error: 0, critical: 0, sourceCount: 0, serviceCount: 0 };

function count(value: number) {
  return value.toLocaleString("zh-CN");
}

function dateText(value: string, seconds = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    timeZone: DISPLAY_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

function clockText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { timeZone: DISPLAY_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

function shortId(value: string | null, length = 24) {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function rangeForPreset(preset: Preset) {
  const to = new Date();
  const item = PRESETS.find((candidate) => candidate.key === preset) || PRESETS[0];
  return { from: item.months ? dayjs(to).subtract(item.months, "month").toDate() : new Date(to.getTime() - (item.milliseconds || 0)), to };
}

function dateTimeLocalText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function dateFromInput(value: string) {
  if (!value) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickerValue(value: string): Dayjs | null {
  const date = dateFromInput(value);
  return date ? dayjs(date) : null;
}

function draftFromPicker(value: Dayjs | null) {
  return value ? value.format("YYYY-MM-DDTHH:mm") : "";
}

function presetForData(data: LogExplorerResult | null): ActivePreset {
  if (!data) return "15m";
  const duration = Date.parse(data.to) - Date.parse(data.from);
  return PRESETS.find((item) => item.months
    ? Math.abs(Date.parse(data.from) - dayjs(data.to).subtract(item.months, "month").valueOf()) < 5_000
    : Math.abs(duration - (item.milliseconds || 0)) < 5_000)?.key || "custom";
}

function levelMeta(level: string) {
  return LEVEL_META[level as LogLevel] || LEVEL_META.info;
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] || source;
}

function timelineSlots(data: LogExplorerResult | null) {
  if (!data) return [];
  const from = Date.parse(data.from);
  const to = Date.parse(data.to);
  const step = data.bucketSeconds * 1_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step <= 0) return [];
  const byBucket = new Map(data.timeline.map((item) => [Date.parse(item.bucket), item]));
  const slotCount = Math.max(1, Math.ceil((to - from) / step));
  return Array.from({ length: slotCount }, (_, index) => {
    const timestamp = from + index * step;
    return {
      timestamp: new Date(timestamp).toISOString(),
      ...(byBucket.get(timestamp) || { bucket: new Date(timestamp).toISOString(), total: 0, info: 0, warning: 0, error: 0, critical: 0 }),
    };
  });
}

export default function ObservabilityLogExplorer({ initialData, initialError }: ExplorerProps) {
  const [data, setData] = useState<LogExplorerResult | null>(initialData);
  const [queryDraft, setQueryDraft] = useState(initialData?.query || "");
  const [source, setSource] = useState<LogSourceFilter>(initialData?.source || "all");
  const [level, setLevel] = useState<LogLevelFilter>(initialData?.level || "all");
  const [preset, setPreset] = useState<ActivePreset>(() => presetForData(initialData));
  const [fromDraft, setFromDraft] = useState(initialData ? dateTimeLocalText(initialData.from) : "");
  const [toDraft, setToDraft] = useState(initialData ? dateTimeLocalText(initialData.to) : "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>(() => [null, initialData?.nextCursor || null]);

  const summary = data?.summary || EMPTY_SUMMARY;
  const selected = data?.rows.find((item) => item.id === selectedId) || null;
  const slots = useMemo(() => timelineSlots(data), [data]);
  const maxBucket = Math.max(1, ...slots.map((item) => item.total));
  const pageCount = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  async function loadLogs(options: {
    from: Date | string;
    to: Date | string;
    query: string;
    source: LogSourceFilter;
    level: LogLevelFilter;
    cursor?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const limit = options.pageSize || pageSize;
    const params = new URLSearchParams({
      from: typeof options.from === "string" ? options.from : options.from.toISOString(),
      to: typeof options.to === "string" ? options.to : options.to.toISOString(),
      q: options.query,
      source: options.source,
      level: options.level,
      offset: "0",
      limit: String(limit),
    });
    if (options.cursor) params.set("cursor", options.cursor);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/observability/logs?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as LogExplorerResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "日志查询失败");
      setData(body);
      const targetPage = options.page || 0;
      setPage(targetPage);
      setPageCursors((current) => {
        const next = targetPage === 0 ? [null] : current.slice(0, targetPage + 1);
        next[targetPage + 1] = body.nextCursor;
        return next;
      });
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("from", typeof options.from === "string" ? options.from : options.from.toISOString());
      url.searchParams.set("to", typeof options.to === "string" ? options.to : options.to.toISOString());
      if (options.query) url.searchParams.set("q", options.query);
      if (options.source !== "all") url.searchParams.set("source", options.source);
      if (options.level !== "all") url.searchParams.set("level", options.level);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      setSelectedId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "日志查询失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function runPreset(nextPreset: Preset) {
    const range = rangeForPreset(nextPreset);
    setPreset(nextPreset);
    setFromDraft(dateTimeLocalText(range.from.toISOString()));
    setToDraft(dateTimeLocalText(range.to.toISOString()));
    void loadLogs({ from: range.from, to: range.to, query: queryDraft.trim(), source, level, page: 0 });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const from = dateFromInput(fromDraft);
    const to = dateFromInput(toDraft);
    if (!from || !to) {
      setError("请输入完整的开始和结束时间");
      return;
    }
    if (from >= to) {
      setError("开始时间必须早于结束时间");
      return;
    }
    if (to.getTime() > dayjs(from).add(MAX_RANGE_MONTHS, "month").valueOf()) {
      setError("时间范围不能超过 3 个月");
      return;
    }
    setPreset("custom");
    void loadLogs({ from, to, query: queryDraft.trim(), source, level, page: 0 });
  }

  function reset() {
    setQueryDraft("");
    setSource("all");
    setLevel("all");
    const range = rangeForPreset("15m");
    setPreset("15m");
    setFromDraft(dateTimeLocalText(range.from.toISOString()));
    setToDraft(dateTimeLocalText(range.to.toISOString()));
    void loadLogs({ from: range.from, to: range.to, query: "", source: "all", level: "all", page: 0 });
  }

  function goToPage(nextPage: number) {
    if (!data || loading || nextPage < 0 || nextPage >= pageCount || nextPage === page) return;
    const cursor = pageCursors[nextPage] || null;
    if (nextPage > 0 && !cursor) return;
    void loadLogs({ from: data.from, to: data.to, query: data.query, source: data.source, level: data.level, cursor, page: nextPage });
  }

  function changePageSize(value: string) {
    const nextPageSize = Number(value);
    if (!PAGE_SIZES.includes(nextPageSize as (typeof PAGE_SIZES)[number])) return;
    setPageSize(nextPageSize);
    if (!data) return;
    void loadLogs({ from: data.from, to: data.to, query: data.query, source: data.source, level: data.level, page: 0, pageSize: nextPageSize });
  }

  return (
    <div className={`observability-explorer${selected ? " has-detail" : ""}`}>
      <header className="observability-explorer__header">
        <div>
          <span className="fg-mono observability-kicker">FG STUDIO / LOG EXPLORER</span>
          <h1>日志检索</h1>
          <p>把一次异常拆成时间、来源、trace 和完整上下文。先筛选，再打开单条事件详情。</p>
        </div>
        <nav className="observability-explorer__nav" aria-label="观测工具">
          <Link href="/admin/reports">服务监控报表</Link>
          <Link href="/admin">管理后台</Link>
        </nav>
      </header>

      {error ? <div className="observability-explorer__alert" role="alert" aria-live="polite">{error}</div> : null}

      <section className="log-explorer__querybox" aria-label="日志查询条件">
        <form onSubmit={submit}>
          <div className="log-explorer__queryline">
            <span className="fg-mono log-explorer__querymark">QUERY</span>
            <label className="log-explorer__queryfield">
              <span className="sr-only">日志搜索</span>
              <Icon d={["m11 4a7 7 0 1 0 4.9 12L21 21", "m16 16 5 5"]} size={17} />
              <input id="log-search" name="q" autoComplete="off" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="搜索人、event、action、traceId、参数或 payload…" maxLength={512} />
            </label>
            <button className="log-explorer__querybutton" type="submit" disabled={loading}>{loading ? "查询中…" : "查询"}<Icon d={["M5 12h14", "m13 6 6 6-6 6"]} size={15} /></button>
          </div>
          <div className="log-explorer__queryhint"><span>匹配 actor / email / event / action / message / trace / task / route / parameters / JSON</span>{queryDraft ? <button type="button" onClick={() => setQueryDraft("")} aria-label="清除搜索词"><Icon d={["M6 6l12 12", "M18 6 6 18"]} size={13} /></button> : null}</div>
          <div className="log-explorer__timerow">
            <span className="fg-mono log-explorer__timemark">TIME RANGE</span>
            <DatePicker.RangePicker
              className="log-explorer__range-picker"
              popupClassName="log-explorer__range-picker-popup"
              id={{ start: "log-time-from", end: "log-time-to" }}
              locale={zhCN.DatePicker}
              value={[pickerValue(fromDraft), pickerValue(toDraft)]}
              onChange={(values) => {
                setFromDraft(draftFromPicker(values?.[0] || null));
                setToDraft(draftFromPicker(values?.[1] || null));
              }}
              allowClear
              needConfirm={false}
              inputReadOnly
              showTime={{ format: "HH:mm", minuteStep: 1 }}
              format="YYYY-MM-DD HH:mm"
              separator={<span className="fg-mono log-explorer__picker-separator" aria-hidden="true">→</span>}
              placeholder={["开始时间", "结束时间"]}
              aria-label="日志时间范围"
            />
          </div>
        </form>
        <div className="log-explorer__filters">
          <div className="log-explorer__presets" aria-label="时间范围">
            {PRESETS.map((item) => <button key={item.key} type="button" className={preset === item.key ? "is-active" : ""} onClick={() => runPreset(item.key)} disabled={loading}>{item.label}</button>)}
          </div>
          <div className="log-explorer__selects">
            <label htmlFor="log-source"><span>来源</span><select id="log-source" name="source" value={source} onChange={(event) => setSource(event.target.value as LogSourceFilter)}>{SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label htmlFor="log-level"><span>级别</span><select id="log-level" name="level" value={level} onChange={(event) => setLevel(event.target.value as LogLevelFilter)}>{LEVEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button type="button" className="log-explorer__reset" onClick={reset} disabled={loading}>重置</button>
          </div>
        </div>
      </section>

      <section className="log-explorer__summary" aria-label="日志统计">
        <SummaryCard label="命中日志" value={summary.total} detail={data ? `${dateText(data.from, false)} — ${dateText(data.to, false)}` : "等待查询"} accent="default" />
        <SummaryCard label="错误 / 严重" value={summary.error + summary.critical} detail={`${count(summary.critical)} 条 critical`} accent="danger" />
        <SummaryCard label="警告" value={summary.warning} detail={`${count(summary.info)} 条 info`} accent="warning" />
        <SummaryCard label="来源 / 服务" value={`${summary.sourceCount} / ${summary.serviceCount}`} detail="当前筛选范围内" accent="blue" />
      </section>

      <section className="log-explorer__timeline" aria-label="日志时间分布">
        <div className="log-explorer__sectionhead">
          <div><span className="fg-mono log-explorer__eyebrow">EVENT DENSITY</span><h2>时间分布</h2></div>
          <span className="fg-mono log-explorer__sectionmeta">{data ? `${data.bucketSeconds < 3_600 ? `${Math.round(data.bucketSeconds / 60)} 分钟` : `${Math.round(data.bucketSeconds / 3_600)} 小时`} / 桶` : "暂无数据"}</span>
        </div>
        <div className="log-explorer__chart" role="img" aria-label="按时间分布的日志数量柱状图">
          {slots.length ? slots.map((item) => <div key={item.timestamp} className="log-explorer__bar" title={`${dateText(item.timestamp)} · ${item.total} 条`}>
            <div className="log-explorer__barstack" style={{ height: `${item.total ? Math.max(7, item.total / maxBucket * 100) : 2}%` }}>
              <span className="is-critical" style={{ height: `${item.total ? item.critical / item.total * 100 : 0}%` }} />
              <span className="is-error" style={{ height: `${item.total ? item.error / item.total * 100 : 0}%` }} />
              <span className="is-warning" style={{ height: `${item.total ? item.warning / item.total * 100 : 0}%` }} />
              <span className="is-info" style={{ height: `${item.total ? item.info / item.total * 100 : 0}%` }} />
            </div>
          </div>) : <div className="log-explorer__chartempty">当前时间范围没有事件</div>}
        </div>
        {slots.length ? <div className="log-explorer__chartlabels"><span>{clockText(slots[0].timestamp)}</span><span>{clockText(slots[Math.floor(slots.length / 2)].timestamp)}</span><span>{clockText(slots[slots.length - 1].timestamp)}</span></div> : null}
        <div className="log-explorer__legend"><span><i className="is-info" />Info {count(summary.info)}</span><span><i className="is-warning" />Warning {count(summary.warning)}</span><span><i className="is-error" />Error {count(summary.error)}</span><span><i className="is-critical" />Critical {count(summary.critical)}</span></div>
      </section>

      <div className={selected ? "log-explorer__content has-detail" : "log-explorer__content"}>
        <section className="log-explorer__results" aria-label="日志事件流">
          <div className="log-explorer__sectionhead">
            <div><span className="fg-mono log-explorer__eyebrow">EVENT STREAM</span><h2>事件流</h2></div>
            <span className="fg-mono log-explorer__sectionmeta">{data ? `${count(data.rows.length)} / ${count(data.total)} 条 · 第 ${count(page + 1)} / ${count(pageCount)} 页` : "暂无数据"}</span>
          </div>
          <div className="log-explorer__tablewrap">
            <div className="log-explorer__tablehead fg-mono"><span>时间</span><span>级别</span><span>来源 / 主体</span><span>事件 / 动作</span><span>摘要</span><span>关联</span></div>
            {data?.rows.length ? data.rows.map((item) => <LogRow key={item.id} item={item} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} />) : <div className="log-explorer__empty"><span className="fg-mono">NO MATCHING EVENTS</span><strong>没有匹配的日志</strong><p>扩大时间范围，或清除关键词和筛选条件后重新查询。</p></div>}
          </div>
          {data ? <nav className="log-explorer__pagination" aria-label="日志分页">
            <div><span className="fg-mono">PAGE</span><strong>第 {count(page + 1)} / {count(pageCount)} 页</strong><small>本页 {count(data.rows.length)} 条，共 {count(data.total)} 条</small></div>
            <label htmlFor="log-page-size"><span>每页</span><select id="log-page-size" name="pageSize" value={pageSize} onChange={(event) => changePageSize(event.target.value)} aria-label="每页日志条数">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label>
            <div className="log-explorer__pagebuttons"><button type="button" onClick={() => goToPage(page - 1)} disabled={loading || page === 0}>上一页</button><button type="button" onClick={() => goToPage(page + 1)} disabled={loading || !data.hasMore}>下一页</button></div>
          </nav> : null}
        </section>
        {selected ? <LogDetail item={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail, accent }: { label: string; value: number | string; detail: string; accent: string }) {
  return <article className={`log-explorer__summarycard is-${accent}`}><span className="fg-mono">{label}</span><strong>{typeof value === "number" ? count(value) : value}</strong><small>{detail}</small></article>;
}

function LogRow({ item, selected, onSelect }: { item: LogRecord; selected: boolean; onSelect: () => void }) {
  const meta = levelMeta(item.level);
  const context = logContext(item);
  return <button type="button" className={`log-explorer__row ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-expanded={selected}>
    <span className="fg-mono log-explorer__time">{dateText(item.occurredAt)}</span>
    <span className={`log-explorer__level log-explorer__level-table ${meta.className}`}><i />{meta.label}</span>
    <span className="log-explorer__source"><strong>{sourceLabel(item.source)}</strong><small title={principalLabel(item, context)}>{principalLabel(item, context)}</small></span>
    <span className="log-explorer__event"><strong title={item.event}>{item.event}</strong><small title={context.action || item.outcome}>{context.action || `${item.kind} · ${item.outcome}`}</small></span>
    <span className="log-explorer__message"><strong title={item.message}>{item.message || "无摘要"}</strong><small>{item.route || item.taskId || item.requestId || "无额外关联"}</small></span>
    <span className="fg-mono log-explorer__trace" title={item.traceId || item.eventId || "无 trace"}>{shortId(item.traceId || item.eventId)}</span>
  </button>;
}

type ExchangeSide = {
  hasData: boolean;
  method: string | null;
  url: string | null;
  headers: unknown;
  encoding: string | null;
  status: string | null;
  statusText: string | null;
  body: unknown;
};

function asDetailRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function detailValue(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

type LogContext = {
  actorId: string | null;
  actorEmail: string | null;
  workspaceId: string | null;
  feature: string | null;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  parameters: unknown;
  data: unknown;
  metadata: unknown;
};

type DetailField = [string, string | number | null];

function logContext(item: LogRecord): LogContext {
  const details = asDetailRecord(item.details) || {};
  const parameters = detailValue(details, ["parameters", "params", "input", "args", "arguments"]);
  const data = detailValue(details, ["data"]);
  const metadata = detailValue(details, ["metadata", "meta"]);
  const metadataRecord = asDetailRecord(metadata);
  const parameterRecord = asDetailRecord(parameters);
  const dataRecord = asDetailRecord(data);
  return {
    actorId: item.userId
      || detailText(detailValue(details, ["actorId", "actor_id", "userId", "user_id"]))
      || detailText(detailValue(metadataRecord, ["actorId", "actor_id", "userId", "user_id", "clientActorId"])),
    actorEmail: item.actorEmail
      || detailText(detailValue(details, ["actorEmail", "actor_email", "email"]))
      || detailText(detailValue(metadataRecord, ["actorEmail", "actor_email", "email", "clientActorEmail"])),
    workspaceId: detailText(detailValue(details, ["workspaceId", "workspace_id"]) ?? detailValue(parameterRecord, ["workspaceId", "workspace_id"]) ?? detailValue(dataRecord, ["workspaceId", "workspace_id"])),
    feature: detailText(detailValue(details, ["feature"])) || item.service,
    action: detailText(detailValue(details, ["action", "operation"])) || item.event,
    resourceType: detailText(detailValue(details, ["resourceType", "resource_type"])),
    resourceId: detailText(detailValue(details, ["resourceId", "resource_id"])),
    statusBefore: detailText(detailValue(details, ["statusBefore", "status_before"])),
    statusAfter: detailText(detailValue(details, ["statusAfter", "status_after"])),
    parameters,
    data,
    metadata,
  };
}

function principalLabel(item: LogRecord, context: LogContext) {
  if (context.actorEmail) return context.actorEmail;
  if (context.actorId) return shortId(context.actorId, 20);
  if (item.source === "frontend") return "浏览器会话 / 未关联账户";
  return item.service || "系统 / 未记录";
}

function resourceText(context: LogContext) {
  if (context.resourceType && context.resourceId) return `${context.resourceType} / ${context.resourceId}`;
  return context.resourceType || context.resourceId;
}

function detailText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function detailValueText(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) || String(value);
  } catch {
    return String(value);
  }
}

function exchangeSide(item: LogRecord): { exchangeId: string | null; request: ExchangeSide; response: ExchangeSide } {
  const details = asDetailRecord(item.details) || {};
  const requestRecord = asDetailRecord(details.request);
  const responseRecord = asDetailRecord(details.response);
  const requestBody = detailValue(requestRecord, ["body", "bodyText"]) ?? detailValue(details, ["requestBody", "requestBodyText"]);
  const responseText = detailValue(responseRecord, ["bodyText", "text"]) ?? detailValue(details, ["responseBodyText"]);
  const responseBody = responseText ?? detailValue(responseRecord, ["body", "data"]) ?? detailValue(details, ["responseBody", "response"]);
  const request: ExchangeSide = {
    hasData: false,
    method: detailText(detailValue(requestRecord, ["method"]) ?? detailValue(details, ["requestMethod", "method"])),
    url: detailText(detailValue(requestRecord, ["url"]) ?? detailValue(details, ["requestUrl", "url"])),
    headers: detailValue(requestRecord, ["headers"]) ?? detailValue(details, ["requestHeaders"]),
    encoding: detailText(detailValue(requestRecord, ["bodyEncoding", "encoding"]) ?? detailValue(details, ["requestBodyEncoding"])),
    status: null,
    statusText: null,
    body: requestBody,
  };
  const response: ExchangeSide = {
    hasData: false,
    method: null,
    url: null,
    headers: detailValue(responseRecord, ["headers"]) ?? detailValue(details, ["responseHeaders"]),
    encoding: detailText(detailValue(responseRecord, ["bodyEncoding", "encoding"]) ?? detailValue(details, ["responseBodyEncoding"])),
    status: detailText(detailValue(responseRecord, ["status", "statusCode"]) ?? detailValue(details, ["responseStatus", "httpStatus"]) ?? item.httpStatus),
    statusText: detailText(detailValue(responseRecord, ["statusText"]) ?? detailValue(details, ["responseStatusText", "httpStatusText"])),
    body: responseBody,
  };
  request.hasData = [request.method, request.url, request.headers, request.encoding, request.body].some((value) => value !== null && value !== undefined);
  response.hasData = [response.status, response.statusText, response.headers, response.encoding, response.body].some((value) => value !== null && value !== undefined);
  return { exchangeId: detailText(details.exchangeId), request, response };
}

function LogDataBlock({ label, value }: { label: string; value: unknown }) {
  return <div className="log-explorer__datablock"><span className="fg-mono">{label}</span><pre>{detailValueText(value)}</pre></div>;
}

function LogExchangeCard({ side, title, data, emptyMessage }: { side: "request" | "response"; title: string; data: ExchangeSide; emptyMessage: string }) {
  const fields = side === "request"
    ? [["方法", data.method], ["URL", data.url], ["编码", data.encoding]]
    : [["状态", data.status], ["状态文本", data.statusText], ["编码", data.encoding]];
  return <article className={`log-explorer__exchangecard is-${side}`}>
    <header className="log-explorer__exchangecardhead"><span className="fg-mono">{side.toUpperCase()}</span><strong>{title}</strong></header>
    {data.hasData ? <>
      <dl className="log-explorer__exchangefields">{fields.map(([label, value]) => value ? <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div> : null)}</dl>
      {data.headers !== null && data.headers !== undefined ? <LogDataBlock label="Headers" value={data.headers} /> : null}
      {data.body !== null && data.body !== undefined ? <LogDataBlock label="Body" value={data.body} /> : null}
    </> : <p className="log-explorer__exchangeempty">{emptyMessage}</p>}
  </article>;
}

function DetailFields({ fields, featured = false }: { fields: DetailField[]; featured?: boolean }) {
  return <dl className={`log-explorer__detailfields${featured ? " is-featured" : ""}`}>{fields.map(([label, value]) => value !== null && value !== undefined && value !== "" ? <div key={label}><dt>{label}</dt><dd className={label.endsWith("ID") || label === "Route" || label === "资源" || label === "发生时间" ? "fg-mono" : ""} title={String(value)}>{String(value)}</dd></div> : null)}</dl>;
}

function LogDetail({ item, onClose }: { item: LogRecord; onClose: () => void }) {
  const meta = levelMeta(item.level);
  const [copied, setCopied] = useState("");
  const detailJson = JSON.stringify(item, null, 2) || "{}";
  const exchange = exchangeSide(item);
  const context = logContext(item);
  const keyFields: DetailField[] = [
    ["主体", principalLabel(item, context)],
    ["发生时间", dateText(item.occurredAt)],
    ["动作", context.action || item.event],
    ["来源", sourceLabel(item.source)],
    ["服务", item.service],
    ["结果", item.outcome],
  ];
  const contextFields: DetailField[] = [
    ["功能", context.feature || item.service],
    ["资源", resourceText(context)],
    ["工作区", context.workspaceId],
    ["状态变化", context.statusBefore || context.statusAfter ? `${context.statusBefore || "—"} → ${context.statusAfter || "—"}` : null],
  ];
  const correlationFields: DetailField[] = [
    ["记录 ID", item.id],
    ["Event ID", item.eventId],
    ["Exchange ID", detailText(detailValue(asDetailRecord(item.details), ["exchangeId"]))],
    ["Stage", detailText(detailValue(asDetailRecord(item.details), ["stage"]))],
    ["Operation", detailText(detailValue(asDetailRecord(item.details), ["operation"]))],
    ["Trace ID", item.traceId],
    ["Request ID", item.requestId],
    ["Task ID", item.taskId],
    ["User ID", item.userId],
    ["Route", item.route],
    ["HTTP", item.httpStatus],
    ["耗时", item.durationMs === null ? null : `${item.durationMs} ms`],
  ];

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1_500);
    } catch {
      setCopied("复制失败");
    }
  }

  return <aside className="log-explorer__detail" aria-label="日志详情">
    <header className="log-explorer__detailhead">
      <div className="log-explorer__detailidentity"><span className={`log-explorer__level log-explorer__level-detail ${meta.className}`}><i />{meta.label}</span><span className="fg-mono log-explorer__detailkind">{item.kind.toUpperCase()} / {item.id}</span><h2 title={item.event}>{item.event}</h2></div>
      <button type="button" className="log-explorer__close" onClick={onClose} aria-label="关闭详情"><Icon d={["M6 6l12 12", "M18 6 6 18"]} size={17} /></button>
    </header>
    <div className="log-explorer__detailbody">
      <div className="log-explorer__contextlabel"><span className="fg-mono">EVENT CONTEXT</span></div>
      <DetailFields fields={keyFields} featured />
      <p className={`log-explorer__detailmessage ${meta.className}`}>{item.message || "无摘要"}</p>
      <DetailFields fields={contextFields} />
      <div className="log-explorer__contextlabel log-explorer__contextlabel-secondary"><span className="fg-mono">CORRELATION</span></div>
      <DetailFields fields={correlationFields} />
      {context.parameters !== null && context.parameters !== undefined ? <LogDataBlock label="Parameters / 执行参数" value={context.parameters} /> : null}
      {context.data !== null && context.data !== undefined ? <LogDataBlock label="Data / 业务数据" value={context.data} /> : null}
      {context.metadata !== null && context.metadata !== undefined ? <LogDataBlock label="Metadata / 附加元数据" value={context.metadata} /> : null}
      <section className="log-explorer__exchange" aria-label="请求与响应信息">
        <div className="log-explorer__payloadhead"><span className="fg-mono">HTTP EXCHANGE</span><span className="fg-mono log-explorer__exchangeid">{exchange.exchangeId || "未关联 exchangeId"}</span></div>
        <div className="log-explorer__exchangegrid">
          <LogExchangeCard side="request" title="请求信息" data={exchange.request} emptyMessage="本条事件没有记录请求；可按 Exchange ID 查看配对事件。" />
          <LogExchangeCard side="response" title="响应信息" data={exchange.response} emptyMessage="本条事件没有记录响应；请求可能仍在处理中或记录在配对事件中。" />
        </div>
      </section>
      <div className="log-explorer__payloadhead"><span className="fg-mono">FULL EVENT JSON</span><button type="button" onClick={() => void copy("JSON 已复制", detailJson)}>{copied || "复制 JSON"}</button></div>
      <pre className="log-explorer__payload">{detailJson}</pre>
      {item.traceId ? <button type="button" className="log-explorer__tracecopy" onClick={() => void copy("Trace ID 已复制", item.traceId || "")}>{copied || "复制 Trace ID"}<Icon d={["M8 8h10v10H8z", "M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]} size={14} /></button> : null}
    </div>
  </aside>;
}
