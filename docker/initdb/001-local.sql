create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references app_users(id) on delete cascade,
  email text not null unique,
  platform_role text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists whitelist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text,
  cover text,
  created_by uuid references app_users(id) on delete set null,
  story_bible jsonb not null default '{}'::jsonb,
  overview jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists project_join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'pending',
  decided_by uuid references app_users(id) on delete set null,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function add_project_owner()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is not null then
    insert into project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_add_owner on projects;
create trigger projects_add_owner after insert on projects for each row execute function add_project_owner();

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  idx integer not null default 1,
  title text not null default '',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  idx integer not null default 1,
  title text not null default '',
  setting text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  ord integer not null default 1,
  no text not null default '',
  title text,
  time_start numeric,
  time_end numeric,
  duration_s numeric not null default 4,
  script_beat text,
  roles jsonb not null default '[]'::jsonb,
  frame_path text,
  keyframe_path text,
  storyboard_path text,
  keyframe_prompt text,
  storyboard_prompt text,
  video_prompt text,
  video_method text,
  video_url text,
  outputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subshots (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references shots(id) on delete cascade,
  ord integer not null default 1,
  size text,
  movement text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  body text not null default '',
  source text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  version integer not null default 1,
  source text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  episode_id uuid references episodes(id) on delete set null,
  scene_id uuid references scenes(id) on delete set null,
  user_id uuid references app_users(id) on delete set null,
  name text not null default '',
  kind text not null default 'image',
  type text,
  source text,
  storage_path text,
  path text,
  external_url text,
  poster_path text,
  description text,
  gen_prompt text,
  from_script boolean not null default false,
  params jsonb not null default '{}'::jsonb,
  mime_type text,
  width integer,
  height integer,
  duration_ms bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  project_id uuid references projects(id) on delete cascade,
  shot_id uuid references shots(id) on delete set null,
  kind text not null default 'image',
  model text not null default '',
  key_owner text,
  prompt text,
  status text not null default 'succeeded',
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  model text not null default '',
  kind text,
  project_id uuid references projects(id) on delete set null,
  total_tokens bigint not null default 0,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists custom_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  scope text not null default 'project',
  title text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,
  scope text not null default 'project',
  ref_key text not null default '',
  graph jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scope, ref_key)
);

create table if not exists creator_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references app_users(id) on delete cascade,
  name text not null default '我的创作空间',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  folder_id uuid references creator_folders(id) on delete set null,
  kind text not null default 'chat',
  title text not null default '未命名对话',
  default_model text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references creator_sessions(id) on delete cascade,
  role text not null,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'complete',
  created_at timestamptz not null default now()
);

create table if not exists creator_canvases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  session_id uuid references creator_sessions(id) on delete set null,
  folder_id uuid references creator_folders(id) on delete set null,
  kind text not null,
  title text not null default '未命名画布',
  graph jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  session_id uuid references creator_sessions(id) on delete set null,
  kind text not null,
  source text not null,
  name text not null,
  storage_path text not null,
  mime_type text,
  width integer,
  height integer,
  duration_ms bigint,
  thumbnail_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_generation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references creator_workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  session_id uuid references creator_sessions(id) on delete set null,
  canvas_id uuid references creator_canvases(id) on delete set null,
  node_id text,
  kind text not null,
  provider text not null,
  model text not null,
  filter_off boolean not null default false,
  idempotency_key text not null unique,
  external_task_id text,
  status text not null default 'draft',
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  confirmed_at timestamptz,
  submission_started_at timestamptz,
  reconciliation_required_at timestamptz,
  last_provider_checked_at timestamptz,
  submission_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists creator_generation_task_events (
  id bigserial primary key,
  task_id uuid not null references creator_generation_tasks(id) on delete cascade,
  event text not null,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Keep the business timestamp reliable for every task transition.
-- 每次任务状态变化都由数据库维护业务时间，避免应用漏写 updated_at。
create or replace function touch_creator_generation_task_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists creator_generation_tasks_touch_updated_at on creator_generation_tasks;
create trigger creator_generation_tasks_touch_updated_at
before update on creator_generation_tasks
for each row execute function touch_creator_generation_task_updated_at();

create table if not exists generation_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  shot_id uuid references shots(id) on delete set null,
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null default 'video',
  provider text not null default 'wetoken',
  model text not null,
  external_task_id text not null,
  status text not null default 'queued',
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, external_task_id)
);

create table if not exists ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid references creator_workspaces(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  creator_task_id uuid references creator_generation_tasks(id) on delete set null,
  request_id text not null unique,
  provider_request_id text,
  kind text not null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  input_units numeric(20,10) not null default 0,
  output_units numeric(20,10) not null default 0,
  image_count integer not null default 0,
  video_seconds numeric(12,3) not null default 0,
  duration_ms bigint not null default 0,
  resolution text,
  generate_audio boolean,
  reported_cost_usd numeric(20,10),
  estimated_cost_usd numeric(20,10),
  currency text not null default 'USD',
  cost_source text not null default 'unknown' check (cost_source in ('reported', 'estimated', 'unknown')),
  price_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded',
  possibly_charged boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists ai_usage_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  month_start date not null,
  limit_usd numeric(20,10) not null default 0 check (limit_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_start)
);

create index if not exists sessions_user_idx on sessions(user_id, expires_at);
create index if not exists projects_created_by_idx on projects(created_by, created_at desc);
create index if not exists creator_assets_workspace_idx on creator_assets(workspace_id, created_at desc);
create index if not exists creator_tasks_workspace_idx on creator_generation_tasks(workspace_id, status, created_at desc);
create index if not exists creator_task_events_task_idx on creator_generation_task_events(task_id, created_at desc);
create index if not exists usage_ledger_user_idx on ai_usage_ledger(user_id, created_at desc);
