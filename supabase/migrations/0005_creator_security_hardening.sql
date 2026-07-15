-- Explicit Data API grants for tables created through SQL.
grant select, insert, update, delete on public.creator_workspaces to authenticated;
grant select, insert, update, delete on public.creator_folders to authenticated;
grant select, insert, update, delete on public.creator_sessions to authenticated;
grant select, insert, update, delete on public.creator_messages to authenticated;
grant select, insert, update, delete on public.creator_canvases to authenticated;
grant select, insert, update, delete on public.creator_assets to authenticated;
grant select, insert, update, delete on public.creator_generation_tasks to authenticated;
grant select on public.ai_usage_ledger to authenticated;

-- The bootstrap function genuinely needs definer rights for first-row creation,
-- but must never retain PostgreSQL's default PUBLIC execution grant.
revoke execute on function public.ensure_creator_workspace() from public, anon;
grant execute on function public.ensure_creator_workspace() to authenticated;

-- Ownership lookup does not need to bypass RLS. Keep it invoker-scoped.
create or replace function public.owns_creator_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.creator_workspaces w
    where w.id = target_workspace_id
      and w.owner_id = (select auth.uid())
  );
$$;

revoke execute on function public.owns_creator_workspace(uuid) from public, anon;
grant execute on function public.owns_creator_workspace(uuid) to authenticated;

drop policy if exists "creator workspace owner all" on public.creator_workspaces;
create policy "creator workspace owner all"
  on public.creator_workspaces for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "creator folders owner all" on public.creator_folders;
create policy "creator folders owner all"
  on public.creator_folders for all to authenticated
  using ((select public.owns_creator_workspace(workspace_id)))
  with check ((select public.owns_creator_workspace(workspace_id)));

drop policy if exists "creator sessions owner all" on public.creator_sessions;
create policy "creator sessions owner all"
  on public.creator_sessions for all to authenticated
  using ((select public.owns_creator_workspace(workspace_id)))
  with check ((select public.owns_creator_workspace(workspace_id)));

drop policy if exists "creator messages owner all" on public.creator_messages;
create policy "creator messages owner all"
  on public.creator_messages for all to authenticated
  using (
    exists (
      select 1
      from public.creator_sessions s
      where s.id = session_id
        and (select public.owns_creator_workspace(s.workspace_id))
    )
  )
  with check (
    exists (
      select 1
      from public.creator_sessions s
      where s.id = session_id
        and (select public.owns_creator_workspace(s.workspace_id))
    )
  );

drop policy if exists "creator canvases owner all" on public.creator_canvases;
create policy "creator canvases owner all"
  on public.creator_canvases for all to authenticated
  using ((select public.owns_creator_workspace(workspace_id)))
  with check ((select public.owns_creator_workspace(workspace_id)));

drop policy if exists "creator assets owner all" on public.creator_assets;
create policy "creator assets owner all"
  on public.creator_assets for all to authenticated
  using ((select public.owns_creator_workspace(workspace_id)))
  with check ((select public.owns_creator_workspace(workspace_id)));

drop policy if exists "creator tasks owner all" on public.creator_generation_tasks;
create policy "creator tasks owner all"
  on public.creator_generation_tasks for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.owns_creator_workspace(workspace_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.owns_creator_workspace(workspace_id))
  );

drop policy if exists "usage ledger self read" on public.ai_usage_ledger;
create policy "usage ledger self read"
  on public.ai_usage_ledger for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "usage ledger admin read" on public.ai_usage_ledger;
create policy "usage ledger admin read"
  on public.ai_usage_ledger for select to authenticated
  using ((select public.is_admin()));
