begin;

-- Restore only tasks that never reached provider video submission.
-- 仅恢复从未进入 Provider 视频提交阶段的任务，避免重复生成或重复计费。
with recoverable_tasks as (
  select task.id
  from creator_generation_tasks task
  where task.kind = 'video'
    and task.external_task_id is null
    and not exists (
      select 1
      from creator_generation_task_events event
      where event.task_id = task.id
        and event.event in ('usage_reserved', 'provider_request_started')
    )
    and (
      task.status = 'queued'
      or task.status = 'submitting'
      or (
        task.status = 'awaiting_reconciliation'
        and exists (
          select 1
          from creator_generation_task_events event
          where event.task_id = task.id
            and event.event = 'manual_reconciliation_required'
            and event.details->>'operation' = 'CreateAsset'
        )
      )
    )
), recovered_tasks as (
  update creator_generation_tasks task
  set status = 'draft',
      confirmed_at = null,
      submission_started_at = null,
      reconciliation_required_at = null,
      last_provider_checked_at = null,
      submission_attempts = 0,
      completed_at = null,
      output = coalesce(task.output, '{}'::jsonb) - array[
        'provider_asset_ids',
        'provider_references',
        'provider_task_id',
        'submission_phase',
        'video_url'
      ],
      error = '此前视频提交未完成，请重新确认提交'
  from recoverable_tasks recoverable
  where task.id = recoverable.id
  returning task.id
)
insert into creator_generation_task_events (task_id, event, status, details)
select id,
       'worker_flow_rollback_recovered',
       'draft',
       jsonb_build_object('reason', 'video_worker_removed')
from recovered_tasks;

commit;
