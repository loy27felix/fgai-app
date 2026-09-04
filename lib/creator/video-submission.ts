import 'server-only';

import {
  createWetokenVideoTask,
  isDefinitiveWetokenVideoRejection,
  WetokenVideoError,
  WetokenVideoTransportError,
  type VideoReference,
} from '@/lib/ai/video';
import {
  cleanupWetokenAssets,
  isProviderReachableAssetSourceUrl,
  isWetokenAssetUrl,
  isUncertainAssetError,
  prepareWetokenAssetReferences,
  WetokenAssetError,
  WetokenAssetTransportError,
  type WetokenCreatedAsset,
} from '@/lib/ai/wetoken-assets';
import { validateCompletedReferencePaths, validateStoredVideoDraftRequest } from '@/lib/creator/video';
import type { CreatorVideoTask } from '@/lib/creator/types';
import { createAdminClient } from '@/lib/local/admin';
import { createClient } from '@/lib/local/server';
import { query } from '@/lib/local/db';
import { assertMonthlyBudgetAvailable } from '@/lib/usage/budget';
import {
  buildVideoLedgerEntry,
  recordUsageRequired,
  updateVideoUsageBestEffort,
} from '@/lib/usage/ledger';
import { estimateVideoPrice, extractReportedCostUsd } from '@/lib/usage/pricing';
import { ensureVideoOutputStored } from '@/lib/creator/video-persistence';
import { recordVideoTaskEvent } from '@/lib/creator/video-task-events';
import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';
import { WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS } from '@/lib/ai/video';

const SIGNED_URL_TTL_SECONDS = 3600;
const REFERENCE_PREFLIGHT_ATTEMPTS = 3;
const REFERENCE_PREFLIGHT_RETRY_DELAYS_MS = [500, 1500];
const RESUMABLE_PHASES = ['prepared', 'usage_reserved'] as const;
const PROVIDER_PHASE = 'provider_request_started';

const ERRORS = {
  REFERENCES_NOT_READY: '参考素材尚未上传完成',
  REFERENCES_NOT_REACHABLE: '参考素材当前使用局域网地址，外部视频服务无法访问。请配置可访问的媒体地址，或移除参考素材后重试',
  REFERENCES_TEMPORARILY_UNAVAILABLE: '参考素材公网访问暂时不可用，请稍后重试',
  REFERENCES_UPLOAD_FAILED: '参考素材上传到 Wetoken 素材库失败，请稍后重试',
  INVALID_DRAFT: '视频草稿参数无效，已停止确认',
  USAGE_RECORD_FAILED: '视频用量记录写入失败，请稍后重试',
  SUBMIT_FAILED: '视频任务提交失败；状态可能需要对账，请先查看任务历史',
  SUBMIT_STATUS_UNKNOWN: '视频提交结果未知，可能已产生费用，系统正在等待对账，请勿重复提交',
} as const;

type WorkerContext = {
  localClient: ReturnType<typeof createClient>;
  user: { id: string };
  workspace: { id: string };
};

type SubmissionPhase = typeof PROVIDER_PHASE | (typeof RESUMABLE_PHASES)[number];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/([?&](?:token|key|signature|sig)=)[^&\s]+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || fallback;
}

function traceFromTask(task: CreatorVideoTask) {
  const value = asRecord(task.request).confirm_trace_id;
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value)
    ? value
    : `creator-video-worker:${task.id}`;
}

function phaseFromOutput(output: Record<string, unknown>): SubmissionPhase | null {
  const value = output.submission_phase;
  return value === PROVIDER_PHASE || RESUMABLE_PHASES.includes(value as (typeof RESUMABLE_PHASES)[number]) ? value as SubmissionPhase : null;
}

function stripSubmissionOutput(output: Record<string, unknown>) {
  const next = { ...output };
  delete next.provider_asset_ids;
  delete next.provider_references;
  delete next.submission_phase;
  return next;
}

function isVideoReference(value: unknown): value is VideoReference {
  const reference = asRecord(value);
  if (typeof reference.url !== 'string' || !isWetokenAssetUrl(reference.url) || typeof reference.role !== 'string') return false;
  if (reference.type === 'image') return ['first_frame', 'last_frame', 'reference_image'].includes(reference.role);
  if (reference.type === 'video') return reference.role === 'reference_video';
  if (reference.type === 'audio') return reference.role === 'reference_audio';
  return false;
}

function persistedProviderReferences(value: unknown) {
  if (!Array.isArray(value) || !value.every(isVideoReference)) return null;
  return value as VideoReference[];
}

function persistedCreatedAssets(output: Record<string, unknown>, model: string) {
  if (!Array.isArray(output.provider_asset_ids)) return [];
  return output.provider_asset_ids
    .filter((value): value is string => typeof value === 'string' && /^asset-[a-z0-9_-]+$/i.test(value))
    .map((id) => ({ id, model }));
}

async function loadContext(task: CreatorVideoTask): Promise<WorkerContext> {
  const localClient = createAdminClient();
  const workspace = await localClient
    .from('creator_workspaces')
    .select('id')
    .eq('id', task.workspace_id)
    .maybeSingle();
  if (workspace.error || !workspace.data) throw new Error('视频任务所属工作区不存在');
  return {
    localClient,
    user: { id: task.user_id },
    workspace: { id: String((workspace.data as { id: string }).id) },
  };
}

async function updateTask(task: CreatorVideoTask, values: Record<string, unknown>, expectedStatus?: string) {
  let update = createAdminClient()
    .from('creator_generation_tasks')
    .update(values)
    .eq('id', task.id)
    .eq('workspace_id', task.workspace_id)
    .eq('user_id', task.user_id)
    .eq('kind', 'video');
  if (expectedStatus) update = update.eq('status', expectedStatus);
  const result = await update.select('*').maybeSingle();
  if (result.error || !result.data) throw result.error || new Error('视频任务状态更新失败');
  return result.data as CreatorVideoTask;
}

async function assertProviderReferencesReachable(references: VideoReference[], traceId: string, taskId: string) {
  if (references.some((reference) => !isProviderReachableAssetSourceUrl(reference.url))) {
    throw new Error(ERRORS.REFERENCES_NOT_REACHABLE);
  }

  await Promise.all(references.map(async (reference) => {
    for (let attempt = 1; attempt <= REFERENCE_PREFLIGHT_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(reference.url, {
          headers: { Range: 'bytes=0-0' },
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
        });
        const status = response.status;
        await response.body?.cancel();
        if ([401, 403, 404].includes(status)) throw new Error(ERRORS.REFERENCES_NOT_REACHABLE);
        if (response.ok) return;
        if (attempt === REFERENCE_PREFLIGHT_ATTEMPTS) throw new Error(ERRORS.REFERENCES_TEMPORARILY_UNAVAILABLE);
      } catch (error) {
        if (error instanceof Error && (error.message === ERRORS.REFERENCES_NOT_REACHABLE || error.message === ERRORS.REFERENCES_TEMPORARILY_UNAVAILABLE)) throw error;
        if (attempt === REFERENCE_PREFLIGHT_ATTEMPTS) {
          logServerFailure('creator_video_reference_preflight', error, {
            feature: 'creator_video',
            stage: 'reference_preflight_failed',
            traceId,
            taskId,
            type: reference.type,
            role: reference.role,
            attempts: attempt,
          });
          throw new Error(ERRORS.REFERENCES_TEMPORARILY_UNAVAILABLE);
        }
      }
      logServerEvent('creator_video', {
        feature: 'creator_video',
        stage: 'reference_preflight_retry',
        traceId,
        taskId,
        type: reference.type,
        role: reference.role,
        attempt,
      }, 'warn');
      await new Promise((resolve) => setTimeout(resolve, REFERENCE_PREFLIGHT_RETRY_DELAYS_MS[attempt - 1] || 1500));
    }
  }));
}

async function buildProviderReferences(context: WorkerContext, task: CreatorVideoTask, validated: ReturnType<typeof validateStoredVideoDraftRequest>, traceId: string) {
  const request = asRecord(task.request);
  if (request.uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);
  const paths = validateCompletedReferencePaths(request.reference_paths, validated.references, task.user_id, task.id);
  const bucket = context.localClient.storage.from('creator-assets');
  const references: VideoReference[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const manifest = validated.references[index];
    const signed = await bucket.createProviderSignedUrl(paths[index], SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error(ERRORS.REFERENCES_NOT_READY);
    if (manifest.kind === 'image') references.push({ type: 'image', url: signed.data.signedUrl, role: manifest.role as 'first_frame' | 'last_frame' | 'reference_image' });
    else if (manifest.kind === 'video') references.push({ type: 'video', url: signed.data.signedUrl, role: 'reference_video' });
    else references.push({ type: 'audio', url: signed.data.signedUrl, role: 'reference_audio' });
  }
  await assertProviderReferencesReachable(references, traceId, task.id);
  return references;
}

function providerFailureStatus(error: unknown): 'failed' | 'awaiting_reconciliation' {
  if (error instanceof WetokenAssetError && !error.uncertain) return 'failed';
  if (isDefinitiveWetokenVideoRejection(error)) return 'failed';
  return 'awaiting_reconciliation';
}

function providerFailureMessage(error: unknown) {
  if (error instanceof WetokenVideoTransportError || error instanceof WetokenAssetTransportError || isUncertainAssetError(error)) return ERRORS.SUBMIT_STATUS_UNKNOWN;
  if (error instanceof WetokenAssetError) return ERRORS.REFERENCES_UPLOAD_FAILED;
  return safeErrorMessage(error, ERRORS.SUBMIT_FAILED);
}

function providerDiagnostic(error: unknown) {
  if (error instanceof WetokenVideoTransportError || error instanceof WetokenAssetTransportError) {
    return {
      operation: error.operation,
      durationMs: error.durationMs,
      causeName: error.causeName,
      causeCode: error.causeCode,
      ...(error instanceof WetokenAssetTransportError || error.exchangeId ? { exchangeId: error.exchangeId } : {}),
    };
  }
  if (error instanceof WetokenAssetError) return { providerCode: error.providerCode, status: error.status, uncertain: error.uncertain };
  if (error instanceof WetokenVideoError) return { providerCode: error.providerCode, status: error.status, retryable: error.retryable };
  return undefined;
}

async function markUnknownAfterWorkerFailure(task: CreatorVideoTask, traceId: string, error: unknown) {
  const message = ERRORS.SUBMIT_STATUS_UNKNOWN;
  try {
    await updateTask(task, {
      status: 'awaiting_reconciliation',
      error: message,
      reconciliation_required_at: new Date().toISOString(),
      completed_at: null,
    }, 'submitting');
  } catch (persistError) {
    logServerFailure('creator_video_worker_state_persist_failed', persistError, { taskId: task.id, traceId });
  }
  await updateVideoUsageBestEffort({ requestId: `creator-video:${task.id}`, providerStatus: 'unknown' });
  await recordVideoTaskEvent(task.id, 'worker_failure_reconciliation_required', 'awaiting_reconciliation', {
    reason: 'worker_unhandled_failure',
  }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id, error });
}

export async function claimNextVideoTask() {
  const result = await query<CreatorVideoTask>(
    `with next_task as (
       select id
         from creator_generation_tasks
        where kind = 'video'
          and (
            (status = 'queued' and external_task_id is null)
            or (
              status = 'submitting'
              and submission_started_at < now() - interval '5 minutes'
              and output->>'submission_phase' in ('prepared', 'usage_reserved')
            )
          )
        order by case when status = 'queued' then 0 else 1 end, confirmed_at nulls last, created_at
        for update skip locked
        limit 1
     )
     update creator_generation_tasks task
        set status = 'submitting',
            submission_started_at = now(),
            submission_attempts = task.submission_attempts + 1,
            error = null
       from next_task
      where task.id = next_task.id
      returning task.*`,
  );
  return result.rows[0] || null;
}

async function recoverExpiredProviderPhaseTasks() {
  const result = await query<CreatorVideoTask>(
    `update creator_generation_tasks
        set status = 'awaiting_reconciliation',
            reconciliation_required_at = now(),
            error = coalesce(error, $1)
      where kind = 'video'
        and status = 'submitting'
        and submission_started_at < now() - ($2 * interval '1 millisecond')
        and output->>'submission_phase' = $3
      returning *`,
    [ERRORS.SUBMIT_STATUS_UNKNOWN, WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS + 60_000, PROVIDER_PHASE],
  );
  for (const task of result.rows) {
    const traceId = traceFromTask(task);
    await updateVideoUsageBestEffort({ requestId: `creator-video:${task.id}`, providerStatus: 'unknown' });
    await recordVideoTaskEvent(task.id, 'provider_phase_expired', 'awaiting_reconciliation', {
      reason: 'worker_restart_after_provider_request_started',
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
  }
  return result.rows.length;
}

export async function processVideoTaskSubmission(task: CreatorVideoTask, traceId = traceFromTask(task)) {
  const context = await loadContext(task);
  const requestId = `creator-video:${task.id}`;
  const originalOutput = asRecord(task.output);
  const phase = phaseFromOutput(originalOutput);
  let validated: ReturnType<typeof validateStoredVideoDraftRequest>;
  let references: VideoReference[] = [];
  let createdAssets: WetokenCreatedAsset[] = [];
  let ledgerAttempted = phase === 'usage_reserved' || phase === PROVIDER_PHASE;
  let ledgerReserved = ledgerAttempted;
  let providerRequestAttempted = phase === PROVIDER_PHASE;
  let acknowledged: { externalTaskId: string; status: string; output: Record<string, unknown> } | null = null;

  try {
    if (phase === PROVIDER_PHASE) {
      await markUnknownAfterWorkerFailure(task, traceId, new Error('provider phase was interrupted'));
      return;
    }
    validated = validateStoredVideoDraftRequest(task.model, task.request);
    if (asRecord(task.request).uploads_complete !== true) throw new Error(ERRORS.REFERENCES_NOT_READY);

    const pricing = estimateVideoPrice({ model: task.model, duration: validated.duration, resolution: validated.resolution });
    const budget = await assertMonthlyBudgetAvailable({ userId: task.user_id, estimatedCostUsd: pricing?.estimatedCostUsd });
    if (!budget.allowed) throw new Error(budget.message);

    const savedReferences = persistedProviderReferences(originalOutput.provider_references);
    if (phase === 'prepared' || phase === 'usage_reserved') {
      if (!savedReferences) throw new Error('视频提交阶段数据不完整');
      references = savedReferences;
      createdAssets = persistedCreatedAssets(originalOutput, task.model);
      const checked = await prepareWetokenAssetReferences(task.model, references, {
        traceId,
        taskId: task.id,
        idempotencyKey: requestId,
      });
      references = checked.references;
    } else {
      references = await buildProviderReferences(context, task, validated, traceId);
      await recordVideoTaskEvent(task.id, 'references_validated', 'submitting', { referenceCount: references.length }, {
        traceId,
        actorId: task.user_id,
        workspaceId: task.workspace_id,
      });
      const prepared = await prepareWetokenAssetReferences(task.model, references, {
        traceId,
        taskId: task.id,
        idempotencyKey: requestId,
      });
      references = prepared.references;
      createdAssets = prepared.createdAssets;
    }

    if (references.some((reference) => !isWetokenAssetUrl(reference.url))) {
      throw new WetokenAssetError('素材预处理结果不完整', 500, 'asset_preparation_incomplete');
    }
    const preparedOutput = {
      ...originalOutput,
      provider_asset_ids: createdAssets.map((asset) => asset.id),
      provider_references: references,
      submission_phase: 'prepared' as const,
    };
    await updateTask(task, { output: preparedOutput }, 'submitting');
    await recordVideoTaskEvent(task.id, 'provider_assets_ready', 'submitting', {
      referenceCount: references.length,
      assetIds: createdAssets.map((asset) => asset.id).join(','),
      model: task.model,
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });

    if (phase !== 'usage_reserved') {
      ledgerAttempted = true;
      await recordUsageRequired(buildVideoLedgerEntry({
        requestId,
        providerRequestId: task.id,
        userId: task.user_id,
        workspaceId: task.workspace_id,
        provider: 'wetoken',
        model: task.model,
        duration: validated.duration,
        resolution: validated.resolution,
        generateAudio: validated.generateAudio,
        creatorTaskId: task.id,
        pricing,
      }));
      ledgerReserved = true;
      await recordVideoTaskEvent(task.id, 'usage_reserved', 'submitting', { requestId, possiblyCharged: true }, {
        traceId,
        actorId: task.user_id,
        workspaceId: task.workspace_id,
      });
    }

    const providerStartedOutput = { ...preparedOutput, submission_phase: PROVIDER_PHASE };
    await updateTask(task, { output: providerStartedOutput }, 'submitting');
    providerRequestAttempted = true;
    await recordVideoTaskEvent(task.id, 'provider_request_started', 'submitting', {
      provider: 'wetoken',
      model: task.model,
      referenceCount: references.length,
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
    logServerEvent('creator_video', {
      feature: 'creator_video',
      stage: 'provider_submit_started',
      traceId,
      taskId: task.id,
      requestId,
      provider: 'wetoken',
      model: task.model,
      referenceCount: references.length,
    });

    const providerTask = await createWetokenVideoTask({
      model: task.model,
      prompt: validated.effectivePrompt,
      references,
      duration: validated.duration,
      ratio: validated.ratio,
      resolution: validated.resolution,
      watermark: validated.watermark,
      generateAudio: validated.generateAudio,
    }, {
      assetsPrepared: true,
      traceId,
      taskId: task.id,
      idempotencyKey: requestId,
    });
    const raw = asRecord(providerTask.raw);
    const providerData = asRecord(raw.data);
    const providerNestedTask = asRecord(providerData.task);
    const providerContent = asRecord(raw.content || providerData.content || providerNestedTask.content);
    const output: Record<string, unknown> = {
      ...preparedOutput,
      provider_task_id: providerTask.externalTaskId,
      ...(typeof providerContent.video_url === 'string' ? { video_url: providerContent.video_url } : {}),
      submission_phase: 'provider_acknowledged',
    };
    acknowledged = { externalTaskId: providerTask.externalTaskId, status: providerTask.status, output };
    const acknowledgedAt = new Date().toISOString();
    const completedAt = ['succeeded', 'failed', 'expired'].includes(providerTask.status) ? acknowledgedAt : null;
    const persistedTask = await updateTask(task, {
      external_task_id: providerTask.externalTaskId,
      status: providerTask.status,
      output,
      error: null,
      last_provider_checked_at: acknowledgedAt,
      reconciliation_required_at: null,
      completed_at: completedAt,
    }, 'submitting');
    await recordVideoTaskEvent(task.id, 'provider_task_acknowledged', providerTask.status, {
      provider: 'wetoken',
      externalTaskId: providerTask.externalTaskId,
      durationMs: Date.now() - new Date(task.submission_started_at || acknowledgedAt).getTime(),
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
    const settled = await updateVideoUsageBestEffort({
      requestId,
      providerRequestId: providerTask.externalTaskId,
      providerStatus: providerTask.status,
      completedAt,
      reportedCostUsd: extractReportedCostUsd(providerTask.raw),
    });
    await recordVideoTaskEvent(task.id, settled ? 'usage_settled' : 'usage_settlement_failed', providerTask.status, {
      requestId,
      externalTaskId: providerTask.externalTaskId,
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
    if (providerTask.status === 'succeeded') {
      try {
        await ensureVideoOutputStored(context, persistedTask);
      } catch (archiveError) {
        // Provider success is already durable; archival is recoverable and must
        // not turn a completed paid task into a false provider failure.
        // Provider 已成功，归档失败可恢复，不能把已完成的付费任务误标成失败。
        logServerFailure('creator_video_archive_failed', archiveError, {
          feature: 'creator_video',
          stage: 'provider_success_archive_failed',
          traceId,
          taskId: task.id,
          externalTaskId: providerTask.externalTaskId,
        });
      }
    }
  } catch (error) {
    const definitiveRejection = isDefinitiveWetokenVideoRejection(error);
    const uncertainAsset = isUncertainAssetError(error);
    const providerStatus = providerRequestAttempted
      ? providerFailureStatus(error)
      : uncertainAsset
        ? 'awaiting_reconciliation'
        : 'draft';
    const shouldCleanAssets = createdAssets.length > 0
      && !uncertainAsset
      && (providerStatus === 'draft' || definitiveRejection || error instanceof WetokenAssetError && !error.uncertain);
    if (shouldCleanAssets) {
      const cleaned = await cleanupWetokenAssets(createdAssets, { traceId, taskId: task.id });
      await recordVideoTaskEvent(task.id, cleaned ? 'provider_assets_cleaned' : 'provider_assets_cleanup_failed', providerStatus, {
        assetIds: createdAssets.map((asset) => asset.id).join(','),
      }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
    }

    const completedAt = providerStatus === 'failed' ? new Date().toISOString() : null;
    const nextOutput = acknowledged?.output || originalOutput;
    const errorMessage = providerStatus === 'draft'
      ? error instanceof Error && error.message === ERRORS.REFERENCES_NOT_READY ? ERRORS.REFERENCES_NOT_READY : safeErrorMessage(error, ERRORS.INVALID_DRAFT)
      : providerFailureMessage(error);
    try {
      await updateTask(task, providerStatus === 'draft'
        ? {
          status: 'draft',
          confirmed_at: null,
          submission_started_at: null,
          reconciliation_required_at: null,
          completed_at: null,
          output: stripSubmissionOutput(nextOutput),
          error: errorMessage,
        }
        : {
          status: providerStatus,
          reconciliation_required_at: providerStatus === 'awaiting_reconciliation' ? new Date().toISOString() : null,
          completed_at: completedAt,
          output: nextOutput,
          error: errorMessage,
        }, 'submitting');
    } catch (persistError) {
      logServerFailure('creator_video_worker_state_persist_failed', persistError, {
        feature: 'creator_video',
        stage: 'submission_failure_state_persist_failed',
        traceId,
        taskId: task.id,
        nextStatus: providerStatus,
      });
    }
    if (ledgerReserved || ledgerAttempted) {
      const settled = await updateVideoUsageBestEffort({
        requestId,
        providerRequestId: acknowledged?.externalTaskId,
        providerStatus,
        completedAt,
      });
      await recordVideoTaskEvent(task.id, settled ? 'usage_settled' : 'usage_settlement_failed', providerStatus, {
        requestId,
        ledgerStatus: providerStatus === 'failed' ? 'failed' : 'unknown',
      }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id });
    }
    await recordVideoTaskEvent(task.id, providerStatus === 'awaiting_reconciliation' ? 'manual_reconciliation_required' : 'provider_request_failed', providerStatus, {
      provider: 'wetoken',
      reason: providerStatus === 'awaiting_reconciliation' ? 'provider_or_worker_outcome_unknown' : 'definitive_rejection',
      ...providerDiagnostic(error),
    }, { traceId, actorId: task.user_id, workspaceId: task.workspace_id, error });
    logServerFailure('creator_video_worker_submission', error, {
      feature: 'creator_video',
      stage: 'provider_submit_failed',
      traceId,
      taskId: task.id,
      requestId,
      nextStatus: providerStatus,
      providerRequestAttempted,
      ledgerAttempted,
      ...providerDiagnostic(error),
    });
  }
}

export async function processNextVideoTask() {
  await recoverExpiredProviderPhaseTasks();
  const task = await claimNextVideoTask();
  if (!task) return null;
  const traceId = traceFromTask(task);
  await processVideoTaskSubmission(task, traceId).catch(async (error) => {
    logServerFailure('creator_video_worker_unhandled', error, { feature: 'creator_video', taskId: task.id, traceId });
    await markUnknownAfterWorkerFailure(task, traceId, error);
  });
  return { taskId: task.id };
}
