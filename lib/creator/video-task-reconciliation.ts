import 'server-only';
import { WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS } from '@/lib/ai/video';
import type { CreatorVideoTask } from '@/lib/creator/types';
import { recordVideoTaskEvent } from '@/lib/creator/video-task-events';
import { query } from '@/lib/local/db';
import { updateVideoUsageBestEffort } from '@/lib/usage/ledger';

const SUBMISSION_STALE_AFTER_MS = WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS + 60_000;

export async function markStaleVideoSubmission(task: CreatorVideoTask) {
  if (task.external_task_id) return task;
  const isLegacyUnknown = task.status === 'unknown';
  const startedAt = task.submission_started_at || task.confirmed_at;
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const isStaleSubmission = task.status === 'submitting'
    && Number.isFinite(startedAtMs)
    && Date.now() - startedAtMs >= SUBMISSION_STALE_AFTER_MS;
  if (!isLegacyUnknown && !isStaleSubmission) return task;

  const reconciliationRequiredAt = new Date().toISOString();
  const message = 'Provider 提交结果未确认，禁止自动重试，等待人工对账';
  const result = await query<CreatorVideoTask>(
    `update creator_generation_tasks
     set status = 'awaiting_reconciliation',
         reconciliation_required_at = $1,
         error = coalesce(error, $2)
     where id = $3 and kind = 'video' and status = $4
     returning *`,
    [reconciliationRequiredAt, message, task.id, task.status],
  );
  const updated = result.rows[0];
  if (!updated) return task;
  await recordVideoTaskEvent(task.id, 'reconciliation_required', 'awaiting_reconciliation', {
    reason: isLegacyUnknown ? 'legacy_unknown_status' : 'provider_acknowledgement_timeout',
    submissionStartedAt: startedAt,
  });
  await updateVideoUsageBestEffort({
    requestId: 'creator-video:' + task.id,
    providerStatus: 'awaiting_reconciliation',
  });
  return updated;
}
