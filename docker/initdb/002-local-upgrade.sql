alter table if exists chat_sessions
  add column if not exists project_id uuid references projects(id) on delete cascade;

alter table if exists chat_sessions
  add column if not exists scope text not null default 'project';

create index if not exists chat_sessions_user_project_idx
  on chat_sessions(user_id, project_id, scope, updated_at desc);
