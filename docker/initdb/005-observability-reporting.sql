begin;

-- Store host/service health transitions separately from business audit events.
-- 服务健康状态属于基础设施观测，不与用户业务审计事件混在一起。
create table if not exists observability_service_events (
  id bigserial primary key,
  observed_at timestamptz not null default now(),
  host text not null default '',
  service text not null,
  check_name text not null,
  state text not null check (state in ('healthy', 'unhealthy', 'unknown')),
  previous_state text,
  message text not null default '',
  duration_ms integer,
  deployment_version text,
  container_id text,
  event_key text unique,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists observability_service_events_observed_idx
  on observability_service_events(observed_at desc);
create index if not exists observability_service_events_service_idx
  on observability_service_events(service, observed_at desc);

-- Keep one sanitized occurrence for browser, app, provider and deployment errors.
-- 每次错误只保存脱敏后的单条事件，报表再按 fingerprint 汇总，避免丢失首次/末次时间。
create table if not exists observability_error_events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('frontend', 'app', 'provider', 'infra', 'deploy', 'billing', 'data')),
  service text not null default '',
  feature text,
  action text,
  severity text not null default 'error' check (severity in ('info', 'warning', 'error', 'critical')),
  impact text not null default 'unknown' check (impact in ('none', 'degraded', 'blocked', 'unknown')),
  fingerprint text not null,
  code text,
  message text not null default '',
  stack text,
  trace_id text,
  request_id text,
  task_id text,
  user_id uuid,
  route text,
  http_status integer,
  deployment_version text,
  event_key text unique,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists observability_error_events_occurred_idx
  on observability_error_events(occurred_at desc);
create index if not exists observability_error_events_fingerprint_idx
  on observability_error_events(fingerprint, occurred_at desc);
create index if not exists observability_error_events_user_idx
  on observability_error_events(user_id, occurred_at desc);
create index if not exists observability_error_events_source_idx
  on observability_error_events(source, service, occurred_at desc);

-- A report is immutable for one revision and can be superseded by a later
-- reconciliation revision when provider tasks or billing arrive late.
-- 每个修订版保留生成时点，异步任务或账单补齐时生成新修订，不静默覆盖历史结论。
create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('daily', 'weekly', 'monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  is_final boolean not null default false,
  data_as_of timestamptz not null default now(),
  schema_version text not null default '1',
  summary jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_type, period_start, period_end, revision)
);

create index if not exists report_runs_period_idx
  on report_runs(report_type, period_start desc, revision desc);

-- Account snapshots make a report reproducible even if an account later changes
-- its profile or is removed from the active user table.
-- 账户快照保证报表生成后即使账户资料变化，历史报表仍可复核。
create table if not exists report_account_summaries (
  report_run_id uuid not null references report_runs(id) on delete cascade,
  user_id uuid not null,
  account_email text not null default '',
  platform_role text not null default 'user',
  activity_kind text not null default 'ai' check (activity_kind in ('ai', 'session_only', 'ai_and_session')),
  audit_records integer not null default 0,
  usage_calls integer not null default 0,
  successful_calls integer not null default 0,
  failed_calls integer not null default 0,
  in_progress_calls integer not null default 0,
  unknown_calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  image_count integer not null default 0,
  video_seconds numeric(20,3) not null default 0,
  duration_ms bigint not null default 0,
  confirmed_cost_usd numeric(20,10) not null default 0,
  estimated_cost_usd numeric(20,10) not null default 0,
  reserved_cost_usd numeric(20,10) not null default 0,
  unknown_cost_calls integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (report_run_id, user_id)
);

create index if not exists report_account_summaries_user_idx
  on report_account_summaries(user_id, report_run_id);

-- Error rollups retain impact and affected-account counts for the report UI.
-- 错误汇总保留影响级别和受影响账户数，支持直接定位运营影响。
create table if not exists report_error_summaries (
  report_run_id uuid not null references report_runs(id) on delete cascade,
  fingerprint text not null,
  source text not null,
  service text not null default '',
  severity text not null,
  impact text not null,
  code text,
  message text not null default '',
  first_occurred_at timestamptz,
  last_occurred_at timestamptz,
  occurrences integer not null default 0,
  affected_accounts integer not null default 0,
  affected_requests integer not null default 0,
  affected_tasks integer not null default 0,
  sample_trace_id text,
  metadata jsonb not null default '{}'::jsonb,
  primary key (report_run_id, fingerprint, source, service)
);

create index if not exists report_error_summaries_impact_idx
  on report_error_summaries(report_run_id, impact, occurrences desc);

-- Service summaries are derived from transition events and explicitly expose
-- missing observations instead of claiming false 100% availability.
-- 服务汇总由状态变化推导，监控缺失时明确标记数据不完整，不伪造 100% 可用率。
create table if not exists report_service_summaries (
  report_run_id uuid not null references report_runs(id) on delete cascade,
  service text not null,
  check_count integer not null default 0,
  healthy_checks integer not null default 0,
  unhealthy_checks integer not null default 0,
  incident_count integer not null default 0,
  observed_seconds numeric(20,3) not null default 0,
  unhealthy_seconds numeric(20,3) not null default 0,
  availability_ratio numeric(12,9),
  data_complete boolean not null default false,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (report_run_id, service)
);

create index if not exists report_service_summaries_service_idx
  on report_service_summaries(service, report_run_id);

commit;
