"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/studio/ui";
import type {
  LogExplorerResult,
  LogLevel,
  LogLevelFilter,
  LogRecord,
  LogSourceFilter,
} from "@/lib/observability/log-query";

type Preset = "15m" | "1h" | "6h" | "24h" | "7d" | "31d";
type ExplorerProps = { initialData: LogExplorerResult | null; initialError: string };

const PRESETS: Array<{ key: Preset; label: string; milliseconds: number }> = [
  { key: "15m", label: "近 15 分钟", milliseconds: 15 * 60 * 1_000 },
  { key: "1h", label: "近 1 小时", milliseconds: 60 * 60 * 1_000 },
  { key: "6h", label: "近 6 小时", milliseconds: 6 * 60 * 60 * 1_000 },
  { key: "24h", label: "近 24 小时", milliseconds: 24 * 60 * 60 * 1_000 },
  { key: "7d", label: "近 7 天", milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  { key: "31d", label: "近 31 天", milliseconds: 31 * 24 * 60 * 60 * 1_000 },
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
    timeZone: "Asia/Shanghai",
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
  return date.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });
}

function shortId(value: string | null, length = 24) {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function rangeForPreset(preset: Preset) {
  const to = new Date();
  const item = PRESETS.find((candidate) => candidate.key === preset) || PRESETS[3];
  return { from: new Date(to.getTime() - item.milliseconds), to };
}

function presetForData(data: LogExplorerResult | null): Preset {
  if (!data) return "24h";
  const duration = Date.parse(data.to) - Date.parse(data.from);
  return PRESETS.find((item) => Math.abs(duration - item.milliseconds) < 5_000)?.key || "24h";
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
  const [preset, setPreset] = useState<Preset>(() => presetForData(initialData));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  const summary = data?.summary || EMPTY_SUMMARY;
  const selected = data?.rows.find((item) => item.id === selectedId) || null;
  const slots = useMemo(() => timelineSlots(data), [data]);
  const maxBucket = Math.max(1, ...slots.map((item) => item.total));

  async function loadLogs(options: {
    from: Date | string;
    to: Date | string;
    query: string;
    source: LogSourceFilter;
    level: LogLevelFilter;
    cursor?: string | null;
    append?: boolean;
  }) {
    const params = new URLSearchParams({
      from: typeof options.from === "string" ? options.from : options.from.toISOString(),
      to: typeof options.to === "string" ? options.to : options.to.toISOString(),
      q: options.query,
      source: options.source,
      level: options.level,
      offset: "0",
      limit: "200",
    });
    if (options.cursor) params.set("cursor", options.cursor);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/observability/logs?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as LogExplorerResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "日志查询失败");
      setData((current) => {
        if (!options.append || !current) return body;
        return { ...body, rows: [...current.rows, ...body.rows] };
      });
      if (!options.append) {
        const url = new URL(window.location.href);
        url.search = "";
        url.searchParams.set("from", typeof options.from === "string" ? options.from : options.from.toISOString());
        url.searchParams.set("to", typeof options.to === "string" ? options.to : options.to.toISOString());
        if (options.query) url.searchParams.set("q", options.query);
        if (options.source !== "all") url.searchParams.set("source", options.source);
        if (options.level !== "all") url.searchParams.set("level", options.level);
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      }
      if (!options.append) setSelectedId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "日志查询失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function runQuery(nextPreset = preset) {
    const range = rangeForPreset(nextPreset);
    setPreset(nextPreset);
    return loadLogs({ from: range.from, to: range.to, query: queryDraft.trim(), source, level });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery();
  }

  function reset() {
    setQueryDraft("");
    setSource("all");
    setLevel("all");
    setPreset("24h");
    const range = rangeForPreset("24h");
    void loadLogs({ from: range.from, to: range.to, query: "", source: "all", level: "all" });
  }

  function loadMore() {
    if (!data?.hasMore || !data.nextCursor || loading) return;
    void loadLogs({
      from: data.from,
      to: data.to,
      query: data.query,
      source: data.source,
      level: data.level,
      cursor: data.nextCursor,
      append: true,
    });
  }

  return (
    <div className="observability-explorer">
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
              <input id="log-search" name="q" autoComplete="off" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="搜索 event、traceId、服务、错误信息或 payload…" maxLength={512} />
            </label>
            <button className="log-explorer__querybutton" type="submit" disabled={loading}>{loading ? "查询中…" : "查询"}<Icon d={["M5 12h14", "m13 6 6 6-6 6"]} size={15} /></button>
          </div>
          <div className="log-explorer__queryhint"><span>匹配 event / message / trace / task / route / JSON 字段</span>{queryDraft ? <button type="button" onClick={() => setQueryDraft("")} aria-label="清除搜索词"><Icon d={["M6 6l12 12", "M18 6 6 18"]} size={13} /></button> : null}</div>
        </form>
        <div className="log-explorer__filters">
          <div className="log-explorer__presets" aria-label="时间范围">
            {PRESETS.map((item) => <button key={item.key} type="button" className={preset === item.key ? "is-active" : ""} onClick={() => void runQuery(item.key)} disabled={loading}>{item.label}</button>)}
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
            <span className="fg-mono log-explorer__sectionmeta">{data ? `${count(data.rows.length)} / ${count(data.total)} 条` : "暂无数据"}</span>
          </div>
          <div className="log-explorer__tablewrap">
            <div className="log-explorer__tablehead fg-mono"><span>时间</span><span>级别</span><span>来源</span><span>事件</span><span>摘要</span><span>关联</span></div>
            {data?.rows.length ? data.rows.map((item) => <LogRow key={item.id} item={item} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} />) : <div className="log-explorer__empty"><span className="fg-mono">NO MATCHING EVENTS</span><strong>没有匹配的日志</strong><p>扩大时间范围，或清除关键词和筛选条件后重新查询。</p></div>}
          </div>
          {data?.hasMore ? <button type="button" className="log-explorer__loadmore" onClick={loadMore} disabled={loading}>{loading ? "加载中…" : `加载更多（还剩 ${count(Math.max(0, data.total - data.rows.length))} 条）`}</button> : null}
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
  return <button type="button" className={`log-explorer__row ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-expanded={selected}>
    <span className="fg-mono log-explorer__time">{dateText(item.occurredAt)}</span>
    <span className={`log-explorer__level ${meta.className}`}><i />{meta.label}</span>
    <span className="log-explorer__source"><strong>{sourceLabel(item.source)}</strong><small>{item.service || "未命名服务"}</small></span>
    <span className="log-explorer__event"><strong title={item.event}>{item.event}</strong><small>{item.kind} · {item.outcome}</small></span>
    <span className="log-explorer__message"><strong title={item.message}>{item.message || "无摘要"}</strong><small>{item.route || item.taskId || item.requestId || "无额外关联"}</small></span>
    <span className="fg-mono log-explorer__trace" title={item.traceId || item.eventId || "无 trace"}>{shortId(item.traceId || item.eventId)}</span>
  </button>;
}

function LogDetail({ item, onClose }: { item: LogRecord; onClose: () => void }) {
  const meta = levelMeta(item.level);
  const [copied, setCopied] = useState("");
  const detailJson = JSON.stringify(item, null, 2) || "{}";
  const fields: Array<[string, string | number | null]> = [
    ["记录 ID", item.id],
    ["Event ID", item.eventId],
    ["发生时间", dateText(item.occurredAt)],
    ["来源", sourceLabel(item.source)],
    ["服务", item.service],
    ["结果", item.outcome],
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
      <div><span className={`log-explorer__level ${meta.className}`}><i />{meta.label}</span><span className="fg-mono log-explorer__detailkind">{item.kind.toUpperCase()} / {item.id}</span><h2 title={item.event}>{item.event}</h2></div>
      <button type="button" className="log-explorer__close" onClick={onClose} aria-label="关闭详情"><Icon d={["M6 6l12 12", "M18 6 6 18"]} size={17} /></button>
    </header>
    <div className="log-explorer__detailbody">
      <p className="log-explorer__detailmessage">{item.message || "无摘要"}</p>
      <dl className="log-explorer__detailfields">{fields.map(([label, value]) => value !== null && value !== undefined && value !== "" ? <div key={label}><dt>{label}</dt><dd className={label.endsWith("ID") || label === "Route" ? "fg-mono" : ""} title={String(value)}>{String(value)}</dd></div> : null)}</dl>
      <div className="log-explorer__payloadhead"><span className="fg-mono">FULL EVENT JSON</span><button type="button" onClick={() => void copy("JSON 已复制", detailJson)}>{copied || "复制 JSON"}</button></div>
      <pre className="log-explorer__payload">{detailJson}</pre>
      {item.traceId ? <button type="button" className="log-explorer__tracecopy" onClick={() => void copy("Trace ID 已复制", item.traceId || "")}>{copied || "复制 Trace ID"}<Icon d={["M8 8h10v10H8z", "M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]} size={14} /></button> : null}
    </div>
  </aside>;
}
