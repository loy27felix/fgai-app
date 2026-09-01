begin;

-- The earlier creator video flow lived only in browser state. Keep its
-- approval plan and delivery jobs server-side so a refresh can reopen the
-- same production instead of losing the workflow.
create table if not exists creator_productions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  session_id uuid not null unique references creator_sessions(id) on delete cascade,
  canvas_project_id text,
  title text not null default '未命名制片项目',
  stage text not null default 'research',
  status text not null default 'draft',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_video_assembly_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  production_id uuid not null references creator_productions(id) on delete cascade,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_productions_workspace_idx
  on creator_productions(workspace_id, updated_at desc);
create index if not exists creator_assembly_jobs_production_idx
  on creator_video_assembly_jobs(production_id, updated_at desc);

commit;
