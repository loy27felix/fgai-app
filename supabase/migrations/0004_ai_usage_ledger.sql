create table if not exists public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.creator_workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  creator_task_id uuid references public.creator_generation_tasks(id) on delete set null,
  request_id text not null unique,
  provider_request_id text,
  kind text not null check (kind in ('text', 'image', 'video')),
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  input_units numeric(20,10) not null default 0,
  output_units numeric(20,10) not null default 0,
  image_count integer not null default 0,
  video_seconds numeric(12,3) not null default 0,
  resolution text,
  generate_audio boolean,
  reported_cost_usd numeric(20,10),
  estimated_cost_usd numeric(20,10),
  currency text not null default 'USD',
  cost_source text not null default 'unknown'
    check (cost_source in ('reported', 'estimated', 'unknown')),
  price_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded'
    check (status in ('submitted', 'succeeded', 'failed', 'unknown')),
  possibly_charged boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (num_nonnulls(workspace_id, project_id) <= 1)
);

create index if not exists ai_usage_ledger_user_created_idx
  on public.ai_usage_ledger(user_id, created_at desc);
create index if not exists ai_usage_ledger_model_created_idx
  on public.ai_usage_ledger(model, created_at desc);
create index if not exists ai_usage_ledger_workspace_created_idx
  on public.ai_usage_ledger(workspace_id, created_at desc)
  where workspace_id is not null;
create index if not exists ai_usage_ledger_project_created_idx
  on public.ai_usage_ledger(project_id, created_at desc)
  where project_id is not null;

alter table public.ai_usage_ledger enable row level security;

drop policy if exists "usage ledger self read" on public.ai_usage_ledger;
create policy "usage ledger self read"
  on public.ai_usage_ledger for select
  using (user_id = (select auth.uid()));

drop policy if exists "usage ledger admin read" on public.ai_usage_ledger;
create policy "usage ledger admin read"
  on public.ai_usage_ledger for select
  using (public.is_admin());

revoke insert, update, delete on public.ai_usage_ledger from anon, authenticated;
