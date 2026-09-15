import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query, withTransaction } from "@/lib/local/db";
import type { MediaOperation, WorkerBackend, WorkerCapability } from "@/types/media-worker";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = "fgw_";

export class MediaWorkerAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code = "WORKER_UNAUTHORIZED", status = 401) {
    super(message);
    this.name = "MediaWorkerAuthError";
    this.code = code;
    this.status = status;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Store only a SHA-256 digest of a Worker bearer token or pairing code. */
export function hashWorkerToken(token: string) {
  return sha256(token);
}

export function timingSafeTokenMatch(token: string, expectedHash: string) {
  if (typeof token !== "string" || typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const received = Buffer.from(hashWorkerToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function pairingCodeExpiry(now = Date.now()) {
  return new Date(now + PAIRING_CODE_TTL_MS);
}

export function workerTokenExpiry(now = Date.now()) {
  return new Date(now + TOKEN_TTL_MS);
}

function randomPairingCode() {
  // Avoid ambiguous characters so an administrator can read the code aloud.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomWorkerToken() {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

function asCapabilities(value: unknown): WorkerCapability {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const operations = Array.isArray(source.operations) ? source.operations.filter((item): item is MediaOperation =>
    item === "video_super_resolution" || item === "watermark_removal" || item === "audio_separation" || item === "subtitle_removal" || item === "subject_removal",
  ) : [];
  const backends = Array.isArray(source.backends) ? source.backends.filter((item): item is WorkerBackend => item === "cuda" || item === "mps" || item === "cpu") : [];
  const modelProfiles = Array.isArray(source.modelProfiles) ? source.modelProfiles.filter((item): item is string => typeof item === "string" && item.length <= 128) : [];
  const maxInputBytes = typeof source.maxInputBytes === "number" ? source.maxInputBytes : 0;
  const maxOutputPixels = typeof source.maxOutputPixels === "number" ? source.maxOutputPixels : 0;
  return { operations, backends, modelProfiles, maxInputBytes, maxOutputPixels };
}

export function normalizeWorkerCapabilities(value: unknown) {
  return asCapabilities(value);
}

export async function createPairingCode(userId: string) {
  if (!userId || typeof userId !== "string") throw new MediaWorkerAuthError("用户标识无效", "INVALID_USER", 400);
  const code = randomPairingCode();
  const expiresAt = pairingCodeExpiry();
  await query(
    "insert into creator_media_worker_pairings (user_id, code_hash, expires_at) values ($1, $2, $3)",
    [userId, hashWorkerToken(code), expiresAt],
  );
  return { code, expiresAt };
}

export type WorkerRegistrationInput = {
  code: string;
  name?: string;
  platform?: string;
  architecture?: string;
  capabilities?: unknown;
};

export async function consumePairingCode(code: string, capabilities: unknown, details?: Pick<WorkerRegistrationInput, "name" | "platform" | "architecture">) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(code)) {
    throw new MediaWorkerAuthError("配对码无效或已过期", "PAIRING_CODE_INVALID", 400);
  }

  const normalizedCapabilities = asCapabilities(capabilities);
  const name = (details?.name || "本机 Worker").trim().slice(0, 128) || "本机 Worker";
  const platform = (details?.platform || "unknown").trim().slice(0, 64) || "unknown";
  const architecture = (details?.architecture || "unknown").trim().slice(0, 64) || "unknown";
  const token = randomWorkerToken();
  const expiresAt = workerTokenExpiry();

  return withTransaction(async (client) => {
    const pairing = await client.query<{ id: string; user_id: string }>(
      `select id, user_id
       from creator_media_worker_pairings
       where code_hash = $1 and consumed_at is null and expires_at > now()
       for update`,
      [hashWorkerToken(code)],
    );
    if (!pairing.rowCount || !pairing.rows[0]) {
      throw new MediaWorkerAuthError("配对码无效或已过期", "PAIRING_CODE_INVALID", 400);
    }

    const worker = await client.query<{ id: string }>(
      `insert into creator_media_workers (user_id, name, platform, architecture, capabilities, status, last_seen_at)
       values ($1, $2, $3, $4, $5::jsonb, 'online', now())
       returning id`,
      [pairing.rows[0].user_id, name, platform, architecture, JSON.stringify(normalizedCapabilities)],
    );
    const workerId = worker.rows[0]?.id;
    if (!workerId) throw new MediaWorkerAuthError("Worker 注册失败", "WORKER_REGISTER_FAILED", 500);

    await client.query(
      `insert into creator_media_worker_tokens (worker_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [workerId, hashWorkerToken(token), expiresAt],
    );
    await client.query(
      "update creator_media_worker_pairings set consumed_at = now() where id = $1",
      [pairing.rows[0].id],
    );

    return { workerId, userId: pairing.rows[0].user_id, token, expiresAt, capabilities: normalizedCapabilities };
  });
}

export type AuthenticatedWorker = {
  workerId: string;
  userId: string;
  capabilities: WorkerCapability;
};

export async function authenticateWorker(request: Request): Promise<AuthenticatedWorker> {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match || match[1].length < 20 || match[1].length > 256) {
    throw new MediaWorkerAuthError("Worker 身份验证失败", "WORKER_UNAUTHORIZED", 401);
  }

  const result = await query<{ worker_id: string; user_id: string; capabilities: unknown }>(
    `select w.id as worker_id, w.user_id, w.capabilities
     from creator_media_worker_tokens t
     join creator_media_workers w on w.id = t.worker_id
     where t.token_hash = $1
       and t.revoked_at is null
       and (t.expires_at is null or t.expires_at > now())
       and w.status <> 'revoked'`,
    [hashWorkerToken(match[1])],
  );
  const row = result.rows[0];
  if (!row) throw new MediaWorkerAuthError("Worker 身份验证失败", "WORKER_UNAUTHORIZED", 401);

  // This update is intentionally best effort. Authentication remains valid if
  // a transient database write fails; heartbeat will report the state again.
  void query("update creator_media_worker_tokens set last_used_at = now() where token_hash = $1", [hashWorkerToken(match[1])]).catch(() => undefined);
  return { workerId: row.worker_id, userId: row.user_id, capabilities: asCapabilities(row.capabilities) };
}

export async function revokeWorker(userId: string, workerId: string) {
  const result = await query<{ id: string }>(
    `update creator_media_workers
     set status = 'revoked', updated_at = now()
     where id = $1 and user_id = $2 and status <> 'revoked'
     returning id`,
    [workerId, userId],
  );
  if (!result.rowCount) return false;
  await query("update creator_media_worker_tokens set revoked_at = now() where worker_id = $1 and revoked_at is null", [workerId]);
  return true;
}

export async function markWorkerHeartbeat(worker: AuthenticatedWorker, capabilities?: unknown) {
  const normalized = capabilities === undefined ? worker.capabilities : asCapabilities(capabilities);
  const result = await query<{ id: string }>(
    `update creator_media_workers
     set status = 'online', last_seen_at = now(), capabilities = $3::jsonb, updated_at = now()
     where id = $1 and user_id = $2 and status <> 'revoked'
     returning id`,
    [worker.workerId, worker.userId, JSON.stringify(normalized)],
  );
  if (!result.rowCount) throw new MediaWorkerAuthError("Worker 已被撤销", "WORKER_REVOKED", 403);
  return normalized;
}

export function mediaWorkerEnabled() {
  return process.env.MEDIA_WORKER_ENABLED === "true";
}

