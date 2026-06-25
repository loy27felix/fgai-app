-- =====================================================================
-- 说明：你的 Supabase 项目 "fgai" 里已经存在完整的基础表结构
-- （profiles / projects / project_members / project_join_requests /
--  whitelist / scripts / scenes / shots / assets / generations 等），
-- 并已启用 RLS、@beva.com 注册域限制(handle_new_user)、新用户建档触发器。
--
-- 本文件只记录 M1 额外补的「粘合层」（已通过 MCP 应用到线上库）。
-- 如果将来在别的 Supabase 项目重建，请先建好基础表，再执行下面这段。
-- =====================================================================

-- 1) 建项目时自动把创建者写为 owner 成员（绕过 RLS 的鸡生蛋问题）
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end $$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- 2) 加入申请：用户可为自己创建一条
drop policy if exists "jr self insert" on public.project_join_requests;
create policy "jr self insert" on public.project_join_requests
  for insert to public with check (user_id = auth.uid());

-- 3) 加入申请：项目负责人/管理员可审批（更新状态）
drop policy if exists "jr owner update" on public.project_join_requests;
create policy "jr owner update" on public.project_join_requests
  for update to public using (
    is_admin() or exists (
      select 1 from public.project_members m
      where m.project_id = project_join_requests.project_id
        and m.user_id = auth.uid() and m.role = 'owner'
    )
  );
