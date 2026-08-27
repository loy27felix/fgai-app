begin;

-- Durable, searchable business audit trail for the local deployment.
-- 本地部署的持久化业务审计流，支持按 trace、操作者、资源和结果检索。
create table if not exists audit_events (
  id bigserial primary key,
  event_id uuid not null unique default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  trace_id text,
  actor_id uuid,
  workspace_id uuid,
  feature text not null,
  action text not null,
  resource_type text,
  resource_id text,
  stage text not null,
  outcome text not null,
  status_before text,
  status_after text,
  duration_ms integer,
  parameters jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  error jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_events_occurred_idx on audit_events(occurred_at desc);
create index if not exists audit_events_trace_idx on audit_events(trace_id, occurred_at desc);
create index if not exists audit_events_actor_idx on audit_events(actor_id, occurred_at desc);
create index if not exists audit_events_workspace_idx on audit_events(workspace_id, occurred_at desc);
create index if not exists audit_events_resource_idx on audit_events(resource_type, resource_id, occurred_at desc);
create index if not exists audit_events_feature_action_idx on audit_events(feature, action, occurred_at desc);

commit;
