import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/local/db";
import { localStorage, localFileSize } from "@/lib/local/storage";
import type { AuthenticatedWorker } from "@/lib/creator/media-worker-auth";

export const WORKER_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const WORKER_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const WORKER_UPLOAD_TTL_MS = 30 * 60 * 1000;

const MIME_ALLOWLIST = new Set([
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
  "image/png", "image/jpeg", "image/webp", "audio/mpeg", "audio/wav", "audio/mp4",
]);

export class WorkerStorageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "WORKER_STORAGE_FAILED", status = 400) {
    super(message);
    this.name = "WorkerStorageError";
    this.code = code;
    this.status = status;
  }
}

function safeId(value: string, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new WorkerStorageError(`${label}无效`, "INVALID_STORAGE_ID", 400);
  return value;
}

function safeName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "result.mp4";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name === "." || name === "..") throw new WorkerStorageError("非法输出文件名", "INVALID_OUTPUT_NAME", 400);
  return name;
}

export function workerAssetPath(userId: string, jobId: string, fileName: string) {
  return `${safeId(userId, "用户")}/processing-results/${safeId(jobId, "任务")}/${safeName(fileName)}`;
}

export function workerTemporaryPath(userId: string, jobId: string, uploadId: string) {
  return `${safeId(userId, "用户")}/processing-tmp/${safeId(jobId, "任务")}/${safeId(uploadId, "上传")}.part`;
}

export function validateUploadRange(input: { start: number; end: number; total: number; received: number }) {
  const { start, end, total, received } = input;
  if (![start, end, total, received].every(Number.isSafeInteger) || start < 0 || end < start || total <= 0 || total > WORKER_UPLOAD_MAX_BYTES || received < 0) {
    throw new WorkerStorageError("上传范围无效", "INVALID_UPLOAD_RANGE", 400);
  }
  if (end >= total || end - start + 1 > WORKER_UPLOAD_CHUNK_BYTES) throw new WorkerStorageError("上传分片大小无效", "INVALID_UPLOAD_RANGE", 400);
  if (start !== received) throw new WorkerStorageError("上传分片必须连续", "UPLOAD_NOT_CONTIGUOUS", 409);
  return { nextReceived: end + 1 };
}

function assertMime(mimeType: unknown) {
  if (typeof mimeType !== "string" || !MIME_ALLOWLIST.has(mimeType.toLowerCase())) throw new WorkerStorageError("不支持的输出媒体类型", "UNSUPPORTED_MEDIA_TYPE", 400);
  return mimeType.toLowerCase();
}

function leaseHeader(request: Request) {
  const value = request.headers.get("x-fg-media-lease-token") || request.headers.get("x-worker-lease-token") || "";
  if (!value || value.length > 256) throw new WorkerStorageError("缺少任务租约", "MEDIA_JOB_LEASE_REQUIRED", 409);
  return value;
}

export function getWorkerLeaseToken(request: Request) { return leaseHeader(request); }

export async function openWorkerInput(worker: AuthenticatedWorker, jobId: string, leaseToken: string) {
  safeId(jobId, "任务");
  const result = await query<{
    workspace_id: string;
    source_asset_id: string;
    storage_path: string;
    mime_type: string | null;
    name: string;
  }>(
    `select j.workspace_id, j.source_asset_id, a.storage_path, a.mime_type, a.name
     from creator_media_processing_jobs j
     join creator_assets a on a.id = j.source_asset_id and a.workspace_id = j.workspace_id
     where j.id = $1 and j.user_id = $2 and j.worker_id = $3 and j.lease_token = $4
       and j.status in ('leased','processing','uploading') and j.lease_expires_at > now()`,
    [jobId, worker.userId, worker.workerId, leaseToken],
  );
  const row = result.rows[0];
  if (!row) throw new WorkerStorageError("任务租约无效或已过期", "MEDIA_JOB_LEASE_INVALID", 409);
  const size = await localFileSize("creator-assets", row.storage_path);
  return { bucket: "creator-assets", storagePath: row.storage_path, mimeType: row.mime_type || "application/octet-stream", name: row.name, size };
}

export async function initWorkerUpload(worker: AuthenticatedWorker, jobId: string, leaseToken: string, input: { expectedBytes: number; mimeType: string; fileName?: string; sha256?: string | null }) {
  safeId(jobId, "任务");
  const expectedBytes = Number(input.expectedBytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > WORKER_UPLOAD_MAX_BYTES) throw new WorkerStorageError("输出文件大小无效", "INVALID_OUTPUT_SIZE", 400);
  const mimeType = assertMime(input.mimeType);
  const expectedSha256 = input.sha256 == null || input.sha256 === "" ? null : String(input.sha256).trim().toLowerCase();
  if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new WorkerStorageError("SHA-256 格式无效", "INVALID_OUTPUT_HASH", 400);
  const fileName = safeName(input.fileName || (mimeType.startsWith("video/") ? "result.mp4" : "result.bin"));

  return withTransaction(async (client) => {
    const job = await client.query<{ workspace_id: string }>(
      `select workspace_id from creator_media_processing_jobs
       where id = $1 and user_id = $2 and worker_id = $3 and lease_token = $4
         and status in ('leased','processing','uploading') and lease_expires_at > now()
       for update`,
      [jobId, worker.userId, worker.workerId, leaseToken],
    );
    const workspaceId = job.rows[0]?.workspace_id;
    if (!workspaceId) throw new WorkerStorageError("任务租约无效或已过期", "MEDIA_JOB_LEASE_INVALID", 409);
    const upload = await client.query<{ id: string }>(
      `insert into creator_media_worker_uploads
       (job_id, worker_id, temporary_path, expected_bytes, expected_sha256, mime_type, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + interval '30 minutes')
       returning id`,
      [jobId, worker.workerId, workerTemporaryPath(worker.userId, jobId, randomUUID()), expectedBytes, expectedSha256, mimeType],
    );
    const uploadId = upload.rows[0]?.id;
    if (!uploadId) throw new WorkerStorageError("上传初始化失败", "UPLOAD_INIT_FAILED", 500);
    const temporaryPath = workerTemporaryPath(worker.userId, jobId, uploadId);
    await client.query("update creator_media_worker_uploads set temporary_path = $2 where id = $1", [uploadId, temporaryPath]);
    await client.query(
      `update creator_media_processing_jobs set status = 'uploading', phase = 'uploading', lease_expires_at = now() + interval '120 seconds' where id = $1`,
      [jobId],
    );
    // The Worker addresses this upload by uploadId only; NAS paths stay a
    // server-side concern and are never sent over the Worker API.
    return { uploadId, chunkSize: WORKER_UPLOAD_CHUNK_BYTES, expectedBytes, mimeType, fileName };
  });
}

export async function writeWorkerUploadChunk(worker: AuthenticatedWorker, uploadId: string, leaseToken: string, range: { start: number; end: number; total: number }, body: Buffer) {
  safeId(uploadId, "上传");
  if (body.byteLength !== range.end - range.start + 1) throw new WorkerStorageError("上传分片长度不匹配", "UPLOAD_LENGTH_MISMATCH", 400);
  return withTransaction(async (client) => {
    const result = await client.query<{ job_id: string; temporary_path: string; received_bytes: number; expected_bytes: number; user_id: string }>(
      `select u.job_id, u.temporary_path, u.received_bytes, u.expected_bytes, j.user_id
       from creator_media_worker_uploads u
       join creator_media_processing_jobs j on j.id = u.job_id
       where u.id = $1 and u.worker_id = $2 and u.status = 'uploading'
         and j.user_id = $3 and j.worker_id = $2 and j.lease_token = $4
         and j.status in ('leased','processing','uploading') and j.lease_expires_at > now()
       for update`,
      [uploadId, worker.workerId, worker.userId, leaseToken],
    );
    const row = result.rows[0];
    if (!row) throw new WorkerStorageError("上传不存在或任务租约无效", "UPLOAD_NOT_FOUND", 409);
    const expectedBytes = Number(row.expected_bytes);
    const receivedBytes = Number(row.received_bytes);
    const rangeResult = validateUploadRange({ ...range, total: expectedBytes, received: receivedBytes });
    const written = await localStorage("creator-assets").writeChunk(row.temporary_path, range.start, body);
    if (written.error || !written.data) throw new WorkerStorageError("写入 NAS 失败，请稍后重试", "NAS_UPLOAD_FAILED", 503);
    await client.query(
      `update creator_media_worker_uploads set received_bytes = $2, updated_at = now() where id = $1`,
      [uploadId, rangeResult.nextReceived],
    );
    await client.query(
      `update creator_media_processing_jobs set lease_expires_at = now() + interval '120 seconds', status = 'uploading' where id = $1`,
      [row.job_id],
    );
    return { uploadId, receivedBytes: rangeResult.nextReceived, complete: rangeResult.nextReceived === expectedBytes };
  });
}

function sniffKind(mimeType: string, prefix: Buffer) {
  if (mimeType.startsWith("video/")) {
    if (mimeType === "video/webm" && prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video";
    if ((mimeType === "video/mp4" || mimeType === "video/quicktime") && prefix.subarray(4, 8).toString("ascii") === "ftyp") return "video";
    if (mimeType === "video/x-matroska" && prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video";
    return null;
  }
  if (mimeType === "image/png" && prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image";
  if (mimeType === "image/jpeg" && prefix.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return "image";
  if (mimeType === "image/webp" && prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

export async function completeWorkerUpload(worker: AuthenticatedWorker, uploadId: string, leaseToken: string, fileName: string) {
  safeId(uploadId, "上传");
  const name = safeName(fileName);
  return withTransaction(async (client) => {
    const result = await client.query<{
      job_id: string;
      workspace_id: string;
      source_asset_id: string;
      temporary_path: string;
      expected_bytes: number;
      expected_sha256: string | null;
      received_bytes: number;
      mime_type: string;
    }>(
      `select u.job_id, j.workspace_id, j.source_asset_id, u.temporary_path, u.expected_bytes,
              u.expected_sha256, u.received_bytes, u.mime_type
       from creator_media_worker_uploads u
       join creator_media_processing_jobs j on j.id = u.job_id
       where u.id = $1 and u.worker_id = $2 and u.status = 'uploading'
         and j.user_id = $3 and j.worker_id = $2 and j.lease_token = $4
         and j.status = 'uploading' and j.lease_expires_at > now()
       for update`,
      [uploadId, worker.workerId, worker.userId, leaseToken],
    );
    const row = result.rows[0];
    if (!row) throw new WorkerStorageError("上传不存在或任务租约无效", "UPLOAD_NOT_FOUND", 409);
    const expectedBytes = Number(row.expected_bytes);
    const receivedBytes = Number(row.received_bytes);
    if (receivedBytes !== expectedBytes) throw new WorkerStorageError("上传尚未完成", "UPLOAD_INCOMPLETE", 409);
    const bucket = localStorage("creator-assets");
    const size = await localFileSize("creator-assets", row.temporary_path);
    const digest = await bucket.sha256(row.temporary_path);
    const prefix = await bucket.readPrefix(row.temporary_path, 32);
    if (!digest.data || !prefix.data || size !== expectedBytes || (row.expected_sha256 && digest.data !== row.expected_sha256) || !sniffKind(row.mime_type, prefix.data)) {
      await bucket.remove([row.temporary_path]);
      await client.query(
        `update creator_media_worker_uploads set status = 'failed', updated_at = now() where id = $1`,
        [uploadId],
      );
      await client.query(
        `update creator_media_processing_jobs set status = 'retryable', worker_id = null, lease_token = null, lease_expires_at = null,
                error_code = 'UPLOAD_VERIFY_FAILED', error_message = '输出文件校验失败，请重试' where id = $1`,
        [row.job_id],
      );
      throw new WorkerStorageError("输出文件校验失败，任务已重新排队", "UPLOAD_VERIFY_FAILED", 422);
    }

    const finalPath = workerAssetPath(worker.userId, row.job_id, name);
    const moved = await bucket.move(row.temporary_path, finalPath);
    if (moved.error) throw new WorkerStorageError("归档到 NAS 失败，请稍后重试", "NAS_ARCHIVE_FAILED", 503);
    const kind = sniffKind(row.mime_type, prefix.data) || "video";
    const asset = await client.query<{ id: string }>(
      `insert into creator_assets (workspace_id, session_id, kind, source, name, storage_path, mime_type, metadata)
       values ($1, null, $2, 'local-worker', $3, $4, $5, $6::jsonb)
       returning id`,
      [row.workspace_id, kind, name, finalPath, row.mime_type, JSON.stringify({ media_processing_job_id: row.job_id, derived_from_asset_id: row.source_asset_id, bytes: size, sha256: digest.data })],
    );
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new WorkerStorageError("结果素材记录创建失败", "OUTPUT_ASSET_FAILED", 500);
    await client.query(
      `update creator_media_worker_uploads set status = 'verified', final_path = $2, updated_at = now() where id = $1`,
      [uploadId, finalPath],
    );
    await client.query(
      `update creator_media_processing_jobs
       set status = 'succeeded', output_asset_id = $2, output = $3::jsonb, progress = 100,
           phase = 'completed', worker_id = null, lease_token = null, lease_expires_at = null,
           completed_at = now(), updated_at = now()
       where id = $1`,
      [row.job_id, assetId, JSON.stringify({ assetId, storagePath: finalPath, mimeType: row.mime_type, bytes: size, sha256: digest.data })],
    );
    await client.query(
      `insert into creator_media_processing_job_events (job_id, event, status, details)
       values ($1, 'media_job_upload_verified', 'succeeded', $2::jsonb)`,
      [row.job_id, JSON.stringify({ assetId, bytes: size, sha256: digest.data })],
    );
    return { jobId: row.job_id, assetId, bytes: size, sha256: digest.data, mimeType: row.mime_type };
  });
}

export function workerLeaseTokenFromRequest(request: Request) { return getWorkerLeaseToken(request); }
