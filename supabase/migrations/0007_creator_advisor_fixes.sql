-- The bootstrap upsert already satisfies the workspace owner RLS policy, so it
-- does not need elevated privileges.
alter function public.ensure_creator_workspace() security invoker;

-- Cover every foreign key introduced by the private creator workspace schema.
create index if not exists ai_usage_ledger_creator_task_idx
  on public.ai_usage_ledger(creator_task_id)
  where creator_task_id is not null;

create index if not exists creator_assets_session_workspace_idx
  on public.creator_assets(session_id, workspace_id)
  where session_id is not null;

create index if not exists creator_canvases_folder_workspace_idx
  on public.creator_canvases(folder_id, workspace_id)
  where folder_id is not null;

create index if not exists creator_canvases_session_workspace_idx
  on public.creator_canvases(session_id, workspace_id)
  where session_id is not null;

create index if not exists creator_folders_workspace_idx
  on public.creator_folders(workspace_id);

create index if not exists creator_tasks_canvas_workspace_idx
  on public.creator_generation_tasks(canvas_id, workspace_id)
  where canvas_id is not null;

create index if not exists creator_tasks_session_workspace_idx
  on public.creator_generation_tasks(session_id, workspace_id)
  where session_id is not null;

create index if not exists creator_tasks_user_idx
  on public.creator_generation_tasks(user_id);

create index if not exists creator_sessions_folder_workspace_idx
  on public.creator_sessions(folder_id, workspace_id)
  where folder_id is not null;
