begin;

-- Existing PostgreSQL volumes do not replay 001-local.sql after their first
-- start. Keep Creator chat durable when an older local deployment is upgraded.
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

-- `CREATE TABLE IF NOT EXISTS` does not alter an older persisted volume. The
-- local deployment predates the durable Creator-session fields, so add each
-- read/write field explicitly before querying or indexing the existing table.
alter table if exists creator_sessions
  add column if not exists workspace_id uuid,
  add column if not exists folder_id uuid,
  add column if not exists kind text,
  add column if not exists title text,
  add column if not exists default_model text,
  add column if not exists archived_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table if exists creator_messages
  add column if not exists session_id uuid,
  add column if not exists role text,
  add column if not exists content jsonb,
  add column if not exists status text,
  add column if not exists created_at timestamptz;

-- Keep legacy rows readable. We intentionally do not make legacy columns
-- NOT NULL here: an old orphaned row must not abort the whole automatic
-- deployment; newly-created rows already use the stricter 001 schema.
update creator_sessions
set
  kind = coalesce(nullif(btrim(kind), ''), 'chat'),
  title = coalesce(nullif(btrim(title), ''), '未命名对话'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where kind is null
  or btrim(kind) = ''
  or title is null
  or btrim(title) = ''
  or created_at is null
  or updated_at is null;

update creator_messages
set
  role = coalesce(nullif(btrim(role), ''), 'user'),
  content = coalesce(content, '{}'::jsonb),
  status = coalesce(nullif(btrim(status), ''), 'complete'),
  created_at = coalesce(created_at, now())
where role is null
  or btrim(role) = ''
  or content is null
  or status is null
  or btrim(status) = ''
  or created_at is null;

alter table if exists creator_sessions
  alter column kind set default 'chat',
  alter column title set default '未命名对话',
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists creator_messages
  alter column content set default '{}'::jsonb,
  alter column status set default 'complete',
  alter column created_at set default now();

create index if not exists creator_sessions_workspace_kind_updated_idx
  on creator_sessions(workspace_id, kind, updated_at desc)
  where archived_at is null;

create index if not exists creator_messages_session_created_idx
  on creator_messages(session_id, created_at);

alter table if exists chat_sessions
  add column if not exists project_id uuid references projects(id) on delete cascade;

alter table if exists chat_sessions
  add column if not exists scope text not null default 'project';

create index if not exists chat_sessions_user_project_idx
  on chat_sessions(user_id, project_id, scope, updated_at desc);

alter table if exists creator_generation_tasks
  add column if not exists submission_started_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz,
  add column if not exists last_provider_checked_at timestamptz,
  add column if not exists submission_attempts integer not null default 0;

create table if not exists creator_generation_task_events (
  id bigserial primary key,
  task_id uuid not null references creator_generation_tasks(id) on delete cascade,
  event text not null,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists creator_task_events_task_idx
  on creator_generation_task_events(task_id, created_at desc);

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

commit;
