create table if not exists public.creator_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null default '我的创作空间',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table if not exists public.creator_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  folder_id uuid,
  kind text not null default 'chat' check (kind in ('chat', 'image', 'video')),
  title text not null default '未命名对话',
  default_model text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (folder_id, workspace_id)
    references public.creator_folders(id, workspace_id) on delete set null
);

create table if not exists public.creator_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.creator_sessions(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content jsonb not null default '{}'::jsonb,
  status text not null default 'complete' check (status in ('draft', 'streaming', 'complete', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.creator_canvases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  session_id uuid,
  folder_id uuid,
  kind text not null check (kind in ('image', 'video')),
  title text not null default '未命名画布',
  graph jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.creator_sessions(id, workspace_id) on delete set null,
  foreign key (folder_id, workspace_id)
    references public.creator_folders(id, workspace_id) on delete set null
);

create table if not exists public.creator_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  session_id uuid,
  kind text not null check (kind in ('image', 'video', 'audio', 'document')),
  source text not null check (source in ('upload', 'generation', 'project_copy')),
  name text not null,
  storage_path text not null,
  mime_type text,
  width integer,
  height integer,
  duration_ms bigint,
  thumbnail_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, workspace_id)
    references public.creator_sessions(id, workspace_id) on delete set null
);

create table if not exists public.creator_generation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid,
  canvas_id uuid,
  node_id text,
  kind text not null check (kind in ('image', 'video')),
  provider text not null,
  model text not null,
  filter_off boolean not null default false,
  idempotency_key text not null unique,
  external_task_id text,
  status text not null default 'draft'
    check (status in ('draft', 'submitting', 'queued', 'running', 'succeeded', 'failed', 'expired', 'unknown')),
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (session_id, workspace_id)
    references public.creator_sessions(id, workspace_id) on delete set null,
  foreign key (canvas_id, workspace_id)
    references public.creator_canvases(id, workspace_id) on delete set null
);

create unique index if not exists creator_generation_tasks_external_idx
  on public.creator_generation_tasks(provider, external_task_id)
  where external_task_id is not null;
create index if not exists creator_sessions_workspace_updated_idx
  on public.creator_sessions(workspace_id, updated_at desc);
create index if not exists creator_messages_session_created_idx
  on public.creator_messages(session_id, created_at);
create index if not exists creator_canvases_workspace_updated_idx
  on public.creator_canvases(workspace_id, updated_at desc);
create index if not exists creator_assets_workspace_created_idx
  on public.creator_assets(workspace_id, created_at desc);
create index if not exists creator_tasks_workspace_status_idx
  on public.creator_generation_tasks(workspace_id, status, created_at desc);

create or replace function public.owns_creator_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.creator_workspaces w
    where w.id = target_workspace_id
      and w.owner_id = (select auth.uid())
  );
$$;

create or replace function public.ensure_creator_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.creator_workspaces (owner_id)
  values (auth.uid())
  on conflict (owner_id) do update set owner_id = excluded.owner_id
  returning id into workspace_id;

  return workspace_id;
end;
$$;

grant execute on function public.ensure_creator_workspace() to authenticated;
grant execute on function public.owns_creator_workspace(uuid) to authenticated;

create or replace function public.touch_creator_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'creator_workspaces',
    'creator_folders',
    'creator_sessions',
    'creator_canvases',
    'creator_assets',
    'creator_generation_tasks'
  ]
  loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_creator_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

alter table public.creator_workspaces enable row level security;
alter table public.creator_folders enable row level security;
alter table public.creator_sessions enable row level security;
alter table public.creator_messages enable row level security;
alter table public.creator_canvases enable row level security;
alter table public.creator_assets enable row level security;
alter table public.creator_generation_tasks enable row level security;

drop policy if exists "creator workspace owner all" on public.creator_workspaces;
create policy "creator workspace owner all"
  on public.creator_workspaces for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "creator folders owner all" on public.creator_folders;
create policy "creator folders owner all"
  on public.creator_folders for all
  using (public.owns_creator_workspace(workspace_id))
  with check (public.owns_creator_workspace(workspace_id));

drop policy if exists "creator sessions owner all" on public.creator_sessions;
create policy "creator sessions owner all"
  on public.creator_sessions for all
  using (public.owns_creator_workspace(workspace_id))
  with check (public.owns_creator_workspace(workspace_id));

drop policy if exists "creator messages owner all" on public.creator_messages;
create policy "creator messages owner all"
  on public.creator_messages for all
  using (
    exists (
      select 1 from public.creator_sessions s
      where s.id = session_id
        and public.owns_creator_workspace(s.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.creator_sessions s
      where s.id = session_id
        and public.owns_creator_workspace(s.workspace_id)
    )
  );

drop policy if exists "creator canvases owner all" on public.creator_canvases;
create policy "creator canvases owner all"
  on public.creator_canvases for all
  using (public.owns_creator_workspace(workspace_id))
  with check (public.owns_creator_workspace(workspace_id));

drop policy if exists "creator assets owner all" on public.creator_assets;
create policy "creator assets owner all"
  on public.creator_assets for all
  using (public.owns_creator_workspace(workspace_id))
  with check (public.owns_creator_workspace(workspace_id));

drop policy if exists "creator tasks owner all" on public.creator_generation_tasks;
create policy "creator tasks owner all"
  on public.creator_generation_tasks for all
  using (
    user_id = (select auth.uid())
    and public.owns_creator_workspace(workspace_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.owns_creator_workspace(workspace_id)
  );

insert into storage.buckets (id, name, public)
values ('creator-assets', 'creator-assets', false)
on conflict (id) do update set public = false;

drop policy if exists "creator assets storage read" on storage.objects;
create policy "creator assets storage read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "creator assets storage insert" on storage.objects;
create policy "creator assets storage insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "creator assets storage update" on storage.objects;
create policy "creator assets storage update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "creator assets storage delete" on storage.objects;
create policy "creator assets storage delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
