import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/local/db";
import { validateMediaJobInput, type MediaProcessingValidationError } from "@/lib/creator/media-processing";
import { logServerEvent } from "@/lib/observability/server-log";
import type { CreateMediaJobInput, MediaJobSpec, MediaJobStatus, WorkerCapability } from "@/types/media-worker";

export const MEDIA_WORKER_LEASE_SECONDS = 120;
export const MEDIA_WORKER_MAX_ATTEMPTS = 3;

export class MediaWorkerQueueError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "MEDIA_JOB_FAILED", status = 400) {
    super(message);
    this.name = "MediaWorkerQueueError";
    this.code = code;
    this.status = status;
  }
}

export type MediaJobRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  operation: string;
  status: MediaJobStatus;
  source_asset_id: string;
  mask_asset_id: string | null;
  output_asset_id: string | null;
  request: Record<string, unknown>;
  output: Record<string, unknown>;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  progress: string | number;
  phase: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type PublicMediaJob = Omit<MediaJobRow, "lease_token"> & { lease_token?: never };

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/[\u0000\r\n]/g, " ").trim().slice(0, maxLength) : "";
}

function safeEventDetails(details: Record<string, unknown> = {}) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
    // Event details are copied to the structured server log.  Keep storage
    // paths, URLs, prompts and credentials out even if a future caller passes
    // an overly broad details object.
    if (/(?:token|secret|password|prompt|storage|path|url|content|body)/i.test(key)) continue;
    if (typeof value === "string") result[key] = safeText(value, 256);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "boolean" || value === null) result[key] = value;
  }
  return result;
}

const WORKER_REQUEST_KEYS = [
  "operation", "sourceAssetId", "maskAssetId", "targetResolution", "modelProfile",
  "idempotencyKey", "sourceMimeType", "sourceWidth", "sourceHeight", "sourceDurationMs",
  "sourceBytes", "outputPixels",
] as const;

function workerSafeRequest(request: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const key of WORKER_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(request, key)) safe[key] = request[key];
  }
  return safe;
}

function rowToWorker(row: MediaJobRow): PublicMediaJob {
  const publicRow = rowToPublic(row);
  // The normalized database column is authoritative if an older row contains
  // a stale or tampered operation value in its JSON request.
  return { ...publicRow, request: { ...workerSafeRequest(row.request), operation: row.operation }, output: {} };
}

async function insertJobEvent(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, jobId: string, event: string, status: string | null, details: Record<string, unknown> = {}) {
  const safeDetails = safeEventDetails(details);
  await client.query(
    `insert into creator_media_processing_job_events (job_id, event, status, details)
     values ($1, $2, $3, $4::jsonb)`,
    [jobId, safeText(event, 96), status, JSON.stringify(safeDetails)],
  );
  // Keep the existing structured observability stream in sync with the durable
  // job event. Never include prompts, signed URLs, bearer tokens, local paths,
  // or media contents in this log.
  logServerEvent(event, { jobId, status, ...safeDetails });
}

function rowToPublic(row: MediaJobRow): PublicMediaJob {
  const { lease_token: _leaseToken, ...publicRow } = row;
  return publicRow;
}

export function nextStatusAfterFailure(attemptCount: number, retryable: boolean): "retryable" | "failed" {
  return retryable && attemptCount < MEDIA_WORKER_MAX_ATTEMPTS ? "retryable" : "failed";
}

export function canWorkerMutateJob(
  lease: { workerId: string | null; leaseToken: string | null; leaseExpiresAt: number | Date | null },
  workerId: string,
  leaseToken: string,
  now = Date.now(),
) {
  if (!lease.workerId || !lease.leaseToken || lease.workerId !== workerId || lease.leaseToken !== leaseToken) return false;
  const expiresAt = lease.leaseExpiresAt instanceof Date ? lease.leaseExpiresAt.getTime() : lease.leaseExpiresAt;
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now;
}

function capabilityArrays(capabilities: WorkerCapability) {
  return {
    operations: Array.isArray(capabilities?.operations) ? capabilities.operations : [],
    modelProfiles: Array.isArray(capabilities?.modelProfiles) ? capabilities.modelProfiles : [],
    maxInputBytes: Number.isFinite(capabilities?.maxInputBytes) ? Math.max(0, capabilities.maxInputBytes) : 0,
    maxOutputPixels: Number.isFinite(capabilities?.maxOutputPixels) ? Math.max(0, capabilities.maxOutputPixels) : 0,
  };
}

function normalizeMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function createMediaJob(userId: string, workspaceId: string, input: CreateMediaJobInput) {
  let spec: MediaJobSpec;
  try {
    spec = validateMediaJobInput(input);
  } catch (error) {
    const validation = error as MediaProcessingValidationError;
    throw new MediaWorkerQueueError(validation.message, "INVALID_MEDIA_JOB", 400);
  }

  return withTransaction(async (client) => {
    const workspace = await client.query<{ id: string }>(
      "select id from creator_workspaces where id = $1 and owner_id = $2",
      [workspaceId, userId],
    );
    if (!workspace.rowCount) throw new MediaWorkerQueueError("创作空间不存在或无权访问", "WORKSPACE_FORBIDDEN", 403);

    const existing = await client.query<MediaJobRow>(
      `select * from creator_media_processing_jobs where user_id = $1 and idempotency_key = $2 for update`,
      [userId, spec.idempotencyKey],
    );
    if (existing.rows[0]) return { job: rowToPublic(existing.rows[0]), replayed: true };

    const source = await client.query<{
      id: string;
      kind: string;
      mime_type: string | null;
      width: number | null;
      height: number | null;
      duration_ms: number | null;
      storage_path: string;
      metadata: unknown;
    }>(
      `select id, kind, mime_type, width, height, duration_ms, storage_path, metadata
       from creator_assets where id = $1 and workspace_id = $2`,
      [spec.sourceAssetId, workspaceId],
    );
    const sourceAsset = source.rows[0];
    if (!sourceAsset) throw new MediaWorkerQueueError("源素材不存在或不属于当前空间", "SOURCE_ASSET_FORBIDDEN", 403);
    if (["video_super_resolution", "watermark_removal"].includes(spec.operation) && sourceAsset.kind !== "video") {
      throw new MediaWorkerQueueError("该媒体处理操作只能处理视频素材", "SOURCE_NOT_VIDEO", 400);
    }

    let maskAsset: { id: string; kind: string; storage_path: string } | null = null;
    if (spec.maskAssetId) {
      const mask = await client.query<{ id: string; kind: string; storage_path: string }>(
        `select id, kind, storage_path from creator_assets where id = $1 and workspace_id = $2`,
        [spec.maskAssetId, workspaceId],
      );
      maskAsset = mask.rows[0] || null;
      if (!maskAsset) throw new MediaWorkerQueueError("遮罩素材不存在或不属于当前空间", "MASK_ASSET_FORBIDDEN", 403);
      if (maskAsset.kind !== "image") throw new MediaWorkerQueueError("遮罩素材必须是图片", "MASK_ASSET_INVALID", 400);
    }

    const metadata = normalizeMetadata(sourceAsset.metadata);
    const sourceBytes = typeof metadata.bytes === "number" && Number.isFinite(metadata.bytes) ? metadata.bytes : null;
    const outputPixels = spec.targetResolution === "1080p" ? 1920 * 1080
      : spec.targetResolution === "2k" ? 2560 * 1440
        : spec.targetResolution === "4k" ? 3840 * 2160 : null;
    const request = {
      operation: spec.operation,
      sourceAssetId: spec.sourceAssetId,
      maskAssetId: spec.maskAssetId,
      targetResolution: spec.targetResolution,
      modelProfile: spec.modelProfile,
      idempotencyKey: spec.idempotencyKey,
      sourceMimeType: sourceAsset.mime_type,
      sourceWidth: sourceAsset.width,
      sourceHeight: sourceAsset.height,
      sourceDurationMs: sourceAsset.duration_ms,
      sourceBytes,
      outputPixels,
      sourceStoragePath: sourceAsset.storage_path,
      maskStoragePath: maskAsset?.storage_path || null,
    };

    const inserted = await client.query<MediaJobRow>(
      `insert into creator_media_processing_jobs
       (user_id, workspace_id, operation, status, source_asset_id, mask_asset_id, request, idempotency_key)
       values ($1, $2, $3, 'queued', $4, $5, $6::jsonb, $7)
       returning *`,
      [userId, workspaceId, spec.operation, spec.sourceAssetId, spec.maskAssetId, JSON.stringify(request), spec.idempotencyKey],
    );
    const job = inserted.rows[0];
    if (!job) throw new MediaWorkerQueueError("媒体任务创建失败", "MEDIA_JOB_CREATE_FAILED", 500);
    await insertJobEvent(client, job.id, "media_job_queued", job.status, { operation: spec.operation, modelProfile: spec.modelProfile });
    return { job: rowToPublic(job), replayed: false };
  });
}

export async function listMediaJobs(userId: string, options?: { workspaceId?: string; limit?: number }) {
  const limit = Math.min(100, Math.max(1, Math.floor(options?.limit || 50)));
  const values: unknown[] = [userId];
  let workspaceClause = "";
  if (options?.workspaceId) {
    values.push(options.workspaceId);
    workspaceClause = ` and workspace_id = $${values.length}`;
  }
  values.push(limit);
  const result = await query<MediaJobRow>(
    `select * from creator_media_processing_jobs
     where user_id = $1${workspaceClause}
     order by created_at desc limit $${values.length}`,
    values,
  );
  return result.rows.map(rowToPublic);
}

export async function getMediaJob(userId: string, jobId: string) {
  const result = await query<MediaJobRow>(
    "select * from creator_media_processing_jobs where id = $1 and user_id = $2",
    [jobId, userId],
  );
  return result.rows[0] ? rowToPublic(result.rows[0]) : null;
}

async function recoverExpiredMediaLeasesWithClient(client: PoolClient, now: Date, maxAttempts: number) {
  const requeued = await client.query<MediaJobRow>(
    `update creator_media_processing_jobs
     set status = 'retryable', worker_id = null, lease_token = null, lease_expires_at = null,
         error_code = 'WORKER_LEASE_EXPIRED', error_message = '本机 Worker 租约已过期，任务重新排队'
     where status in ('leased','processing','uploading')
       and lease_expires_at < $1 and attempt_count < $2
     returning id`,
    [now, maxAttempts],
  );
  const failed = await client.query<MediaJobRow>(
    `update creator_media_processing_jobs
     set status = 'failed', worker_id = null, lease_token = null, lease_expires_at = null,
         error_code = 'WORKER_LEASE_EXPIRED', error_message = '本机 Worker 多次离线，任务失败，请重试', completed_at = now()
     where status in ('leased','processing','uploading')
       and lease_expires_at < $1 and attempt_count >= $2
     returning id`,
    [now, maxAttempts],
  );
  for (const row of requeued.rows) await insertJobEvent(client, row.id, "media_job_retryable", "retryable", { reason: "WORKER_LEASE_EXPIRED" });
  for (const row of failed.rows) await insertJobEvent(client, row.id, "media_job_failed", "failed", { reason: "WORKER_LEASE_EXPIRED" });
  return { requeued: requeued.rowCount || 0, failed: failed.rowCount || 0, deletedSourceAssets: 0 };
}

export async function recoverExpiredMediaLeases(options?: { now?: Date; maxAttempts?: number }) {
  try {
    return await withTransaction((client) => recoverExpiredMediaLeasesWithClient(client, options?.now || new Date(), options?.maxAttempts || MEDIA_WORKER_MAX_ATTEMPTS));
  } catch {
    // Recovery is invoked from a claim/monitor path. A temporarily unavailable
    // database must not make callers believe source assets were deleted.
    return { requeued: 0, failed: 0, deletedSourceAssets: 0 };
  }
}

export type QueueWorkerIdentity = { workerId: string; userId: string; capabilities: WorkerCapability };

export async function claimNextMediaJob(worker: QueueWorkerIdentity) {
  return withTransaction(async (client) => {
    await recoverExpiredMediaLeasesWithClient(client, new Date(), MEDIA_WORKER_MAX_ATTEMPTS);
    const capabilities = capabilityArrays(worker.capabilities);
    if (!capabilities.operations.length || !capabilities.modelProfiles.length || !capabilities.maxInputBytes || !capabilities.maxOutputPixels) return null;
    const leaseToken = "lease_" + randomBytes(24).toString("base64url");
    const claimed = await client.query<MediaJobRow>(
      `with candidate as (
         select j.id
         from creator_media_processing_jobs j
         where j.user_id = $1
           and j.status in ('queued','retryable')
           and j.attempt_count < $2
           and j.operation = any($3::text[])
           and coalesce(j.request->>'modelProfile', '') = any($4::text[])
           and $5::bigint >= coalesce(nullif(j.request->>'sourceBytes','')::bigint, 0)
           and (j.operation <> 'video_super_resolution'
             or $6::bigint >= coalesce(nullif(j.request->>'outputPixels','')::bigint, 0))
         order by j.created_at asc
         for update skip locked
         limit 1
       )
       update creator_media_processing_jobs j
       set status = 'leased', worker_id = $7, lease_token = $8,
           lease_expires_at = now() + ($9::text || ' seconds')::interval,
           attempt_count = j.attempt_count + 1,
           started_at = coalesce(j.started_at, now()), updated_at = now()
       from candidate c
       where j.id = c.id
       returning j.*`,
      [worker.userId, MEDIA_WORKER_MAX_ATTEMPTS, capabilities.operations, capabilities.modelProfiles, capabilities.maxInputBytes, capabilities.maxOutputPixels, worker.workerId, leaseToken, MEDIA_WORKER_LEASE_SECONDS],
    );
    const job = claimed.rows[0];
    if (!job) return null;
    await insertJobEvent(client, job.id, "media_job_claimed", job.status, { workerId: worker.workerId, attempt: job.attempt_count });
    // The Worker receives only IDs and processing parameters.  NAS paths and
    // provider URLs remain server-side and are accessed through lease-bound
    // input/mask endpoints.
    return { job: rowToWorker(job), leaseToken };
  });
}

export async function heartbeatMediaJob(worker: QueueWorkerIdentity, jobId: string, leaseToken: string) {
  const result = await query<MediaJobRow>(
    `update creator_media_processing_jobs
     set lease_expires_at = now() + ($4::text || ' seconds')::interval, updated_at = now()
     where id = $1 and user_id = $2 and worker_id = $3 and lease_token = $5
       and status in ('leased','processing','uploading') and lease_expires_at > now()
     returning *`,
    [jobId, worker.userId, worker.workerId, MEDIA_WORKER_LEASE_SECONDS, leaseToken],
  );
  const job = result.rows[0];
  if (!job) throw new MediaWorkerQueueError("任务租约无效或已过期", "MEDIA_JOB_LEASE_INVALID", 409);
  return rowToPublic(job);
}

export async function reportMediaProgress(worker: QueueWorkerIdentity, jobId: string, leaseToken: string, progress: number, phase?: string | null) {
  const safeProgress = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  const result = await query<MediaJobRow>(
    `update creator_media_processing_jobs
     set status = case when status = 'leased' then 'processing' else status end,
         progress = $4, phase = $5,
         lease_expires_at = now() + ($6::text || ' seconds')::interval, updated_at = now()
     where id = $1 and user_id = $2 and worker_id = $3 and lease_token = $7
       and status in ('leased','processing','uploading') and lease_expires_at > now()
     returning *`,
    [jobId, worker.userId, worker.workerId, safeProgress, safeText(phase, 128) || null, MEDIA_WORKER_LEASE_SECONDS, leaseToken],
  );
  const job = result.rows[0];
  if (!job) throw new MediaWorkerQueueError("任务租约无效或已过期", "MEDIA_JOB_LEASE_INVALID", 409);
  await query(
    `insert into creator_media_processing_job_events (job_id, event, status, details)
     values ($1, 'media_job_progress', $2, $3::jsonb)`,
    [jobId, job.status, JSON.stringify({ progress: safeProgress, phase: safeText(phase, 128) || null })],
  );
  logServerEvent("media_job_progress", { jobId, status: job.status, progress: safeProgress, phase: safeText(phase, 128) || null });
  return rowToPublic(job);
}

export async function failMediaJob(worker: QueueWorkerIdentity, jobId: string, leaseToken: string, input: { retryable?: boolean; errorCode?: string; message?: string }) {
  return withTransaction(async (client) => {
    const found = await client.query<MediaJobRow>(
      `select * from creator_media_processing_jobs
       where id = $1 and user_id = $2 and worker_id = $3 and lease_token = $4
         and status in ('leased','processing','uploading') and lease_expires_at > now()
       for update`,
      [jobId, worker.userId, worker.workerId, leaseToken],
    );
    const existing = found.rows[0];
    if (!existing) throw new MediaWorkerQueueError("任务租约无效或已过期", "MEDIA_JOB_LEASE_INVALID", 409);
    const retryable = input.retryable === true;
    const status = nextStatusAfterFailure(existing.attempt_count, retryable);
    const errorCode = safeText(input.errorCode, 64).toUpperCase() || (retryable ? "WORKER_RETRYABLE" : "WORKER_FAILED");
    const errorMessage = safeText(input.message, 500) || "本机 Worker 处理失败";
    const updated = await client.query<MediaJobRow>(
      `update creator_media_processing_jobs
       set status = $5, worker_id = null, lease_token = null, lease_expires_at = null,
           error_code = $6, error_message = $7,
           completed_at = case when $5 = 'failed' then now() else null end, updated_at = now()
       where id = $1 and user_id = $2 and worker_id = $3 and lease_token = $4
       returning *`,
      [jobId, worker.userId, worker.workerId, leaseToken, status, errorCode, errorMessage],
    );
    await insertJobEvent(client, jobId, status === "failed" ? "media_job_failed" : "media_job_retryable", status, { errorCode, retryable, attempt: existing.attempt_count });
    return rowToPublic(updated.rows[0]);
  });
}

export async function cancelMediaJob(userId: string, jobId: string) {
  return withTransaction(async (client) => {
    const updated = await client.query<MediaJobRow>(
      `update creator_media_processing_jobs
       set status = 'cancelled', worker_id = null, lease_token = null, lease_expires_at = null, completed_at = now(), updated_at = now()
       where id = $1 and user_id = $2 and status not in ('succeeded','failed','cancelled')
       returning *`,
      [jobId, userId],
    );
    const job = updated.rows[0];
    if (!job) {
      const exists = await client.query("select id, status from creator_media_processing_jobs where id = $1 and user_id = $2", [jobId, userId]);
      if (!exists.rowCount) throw new MediaWorkerQueueError("媒体任务不存在", "MEDIA_JOB_NOT_FOUND", 404);
      throw new MediaWorkerQueueError("任务已完成或已取消，不能再取消", "MEDIA_JOB_TERMINAL", 409);
    }
    await insertJobEvent(client, job.id, "media_job_cancelled", job.status, {});
    return rowToPublic(job);
  });
}
