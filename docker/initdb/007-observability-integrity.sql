begin;

-- Keep every error grouping dimension in the snapshot key.
-- 报表错误快照的主键必须包含全部分组维度，避免不同 severity/impact 相互覆盖。
do $$
declare
  primary_key_name text;
begin
  if to_regclass('public.report_error_summaries') is null then
    return;
  end if;

  select constraint_name
    into primary_key_name
    from information_schema.table_constraints
   where table_schema = 'public'
     and table_name = 'report_error_summaries'
     and constraint_type = 'PRIMARY KEY';

  if primary_key_name is not null then
    execute format('alter table public.report_error_summaries drop constraint %I', primary_key_name);
  end if;

  alter table public.report_error_summaries
    add constraint report_error_summaries_group_pkey
    primary key (report_run_id, fingerprint, source, service, severity, impact);
end $$;

commit;
