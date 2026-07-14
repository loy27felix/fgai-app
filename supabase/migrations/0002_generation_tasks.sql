create table if not exists public.generation_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  shot_id uuid references public.shots(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'video' check (kind in ('image', 'video')),
  provider text not null default 'wetoken',
  model text not null,
  external_task_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, external_task_id)
);

create index if not exists generation_tasks_project_status_idx
  on public.generation_tasks(project_id, status, created_at desc);
create index if not exists generation_tasks_shot_idx
  on public.generation_tasks(shot_id, created_at desc);

alter table public.generation_tasks enable row level security;

drop policy if exists 'generation tasks member read' on public.generation_tasks;
create policy 'generation tasks member read'
  on public.generation_tasks for select
  using (public.is_member(project_id));

drop policy if exists 'generation tasks editor insert' on public.generation_tasks;
create policy 'generation tasks editor insert'
  on public.generation_tasks for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.project_members m
      where m.project_id = generation_tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'editor')
    )
  );

drop policy if exists 'generation tasks editor update' on public.generation_tasks;
create policy 'generation tasks editor update'
  on public.generation_tasks for update
  using (
    exists (
      select 1 from public.project_members m
      where m.project_id = generation_tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.project_members m
      where m.project_id = generation_tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'editor')
    )
  );

create or replace function public.touch_generation_task_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists generation_tasks_touch_updated_at on public.generation_tasks;
create trigger generation_tasks_touch_updated_at
  before update on public.generation_tasks
  for each row execute function public.touch_generation_task_updated_at();
