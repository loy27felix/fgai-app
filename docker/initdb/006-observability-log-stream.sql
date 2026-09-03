begin;

-- Persist structured server logs without coupling request latency to the audit UI.
-- 持久化结构化服务日志，但不让请求延迟依赖日志工作台。
create table if not exists observability_log_events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),
  event_id text,
  source text not null check (source in ('audit', 'frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data')),
  service text not null default '',
  event_name text not null,
  level text not null check (level in ('info', 'warning', 'error', 'critical')),
  outcome text not null default '',
  message text not null default '',
  trace_id text,
  request_id text,
  task_id text,
  user_id text,
  route text,
  http_status integer,
  duration_ms integer,
  payload jsonb not null default '{}'::jsonb,
  search_text text not null default ''
);

create index if not exists observability_log_events_occurred_idx
  on observability_log_events(occurred_at desc, id desc);
create index if not exists observability_log_events_trace_idx
  on observability_log_events(trace_id, occurred_at desc, id desc);
create index if not exists observability_log_events_task_idx
  on observability_log_events(task_id, occurred_at desc, id desc);
create index if not exists observability_log_events_source_level_idx
  on observability_log_events(source, level, occurred_at desc, id desc);

commit;
