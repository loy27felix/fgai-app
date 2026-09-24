import { createHash, randomUUID } from "node:crypto";
import { database } from "./store";

export const PRODUCTION_LAB_ASSET_BUCKET = "production-lab-assets";

export type LabMediaKind = "image" | "video";
export type LabMediaStatus = "queued" | "submitting" | "running" | "succeeded" | "failed" | "unknown";
export type LabAssetScope = "official" | "story";

export type LabMediaJob = {
  id: string;
  owner_id: string;
  project_id: string;
  episode: number;
  node_id: string | null;
  kind: LabMediaKind;
  status: LabMediaStatus;
  provider: string;
  provider_request_id: string | null;
  request_id: string;
  idempotency_key: string;
  model: string;
  request: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  estimated_cost_usd: string | null;
  reported_cost_usd: string | null;
  cost_source: "reported" | "estimated" | "unknown";
  accounting_error: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type LabAsset = {
  id: string;
  owner_id: string;
  project_id: string | null;
  episode: number | null;
  scope: LabAssetScope;
  category: string;
  name: string;
  character_name: string;
  style: string;
  view_label: string;
  media_kind: "image" | "video" | "audio";
  storage_path: string;
  mime_type: string;
  bytes: string | number;
  media_job_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NewLabAsset = Omit<LabAsset, "created_at" | "bytes"> & { bytes: number };

export async function writeLabMediaEvent(jobId: string, event: string, actorId?: string, details: Record<string, unknown> = {}) {
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => !/(prompt|url|path|token|secret|content|body)/i.test(key)));
  await database().query(
    "INSERT INTO production_lab_media_job_events(job_id,actor_id,event,details) VALUES($1,$2,$3,$4::jsonb)",
    [jobId, actorId || null, event.slice(0, 100), JSON.stringify(safe)],
  );
}

export async function createLabMediaJob(input: {
  id: string;
  ownerId: string;
  projectId: string;
  episode: number;
  nodeId: string | null;
  kind: LabMediaKind;
  idempotencyKey: string;
  model: string;
  request: Record<string, unknown>;
  estimatedCostUsd?: number;
}) {
  const requestId = "production-lab-" + input.kind + ":" + input.id;
  const requestHash = createHash("sha256").update(JSON.stringify({ model: input.model, request: input.request })).digest("hex");
  const result = await database().query<LabMediaJob>(
    `INSERT INTO production_lab_media_jobs
      (id,owner_id,project_id,episode,node_id,kind,status,request_id,idempotency_key,request_hash,model,request,estimated_cost_usd,cost_source)
     VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10,$11::jsonb,$12,$13)
     ON CONFLICT (owner_id,idempotency_key) DO NOTHING
     RETURNING *`,
    [input.id, input.ownerId, input.projectId, input.episode, input.nodeId, input.kind, requestId, input.idempotencyKey,
      requestHash, input.model, JSON.stringify(input.request), input.estimatedCostUsd ?? null,
      input.estimatedCostUsd === undefined ? "unknown" : "estimated"],
  );
  if (result.rows[0]) {
    await writeLabMediaEvent(input.id, "media_job_queued", input.ownerId, { kind: input.kind, model: input.model, episode: input.episode });
    return { job: result.rows[0], replayed: false };
  }
  const existing = await database().query<LabMediaJob & { request_hash: string }>(
    "SELECT * FROM production_lab_media_jobs WHERE owner_id=$1 AND idempotency_key=$2",
    [input.ownerId, input.idempotencyKey],
  );
  if (!existing.rows[0] || existing.rows[0].request_hash !== requestHash) throw new Error("幂等键已用于其他生成请求；请刷新后重试");
  return { job: existing.rows[0], replayed: true };
}

const JOB_PATCH_COLUMNS: Record<string, string> = {
  status: "status", providerRequestId: "provider_request_id", request: "request", output: "output",
  error: "error", estimatedCostUsd: "estimated_cost_usd", reportedCostUsd: "reported_cost_usd",
  costSource: "cost_source", accountingError: "accounting_error", leaseToken: "lease_token",
  leaseExpiresAt: "lease_expires_at", completedAt: "completed_at", nextPollAt: "next_poll_at",
};

export async function updateLabMediaJob(id: string, patch: Record<string, unknown>, leaseToken?: string | null) {
  const entries = Object.entries(patch).filter(([key]) => JOB_PATCH_COLUMNS[key]);
  if (!entries.length) return null;
  const values: unknown[] = [id];
  const assigns = entries.map(([key, value]) => {
    values.push(key === "request" || key === "output" ? JSON.stringify(value) : value);
    const index = values.length;
    const cast = key === "request" || key === "output" ? "::jsonb" : "";
    return JOB_PATCH_COLUMNS[key] + "=$" + index + cast;
  });
  values.push(leaseToken === undefined ? null : leaseToken);
  const leaseParam = values.length;
  const result = await database().query<LabMediaJob>(
    `UPDATE production_lab_media_jobs SET ${assigns.join(",")},updated_at=now()
     WHERE id=$1 AND ($${leaseParam}::text IS NULL OR lease_token=$${leaseParam}) RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

export async function claimLabMediaSubmission(id: string) {
  const token = randomUUID();
  const result = await database().query<LabMediaJob>(
    `UPDATE production_lab_media_jobs SET status='submitting',lease_token=$2,
      lease_expires_at=now()+interval '3 hours',attempt_count=attempt_count+1,updated_at=now()
     WHERE id=$1 AND status='queued' RETURNING *`,
    [id, token],
  );
  if (result.rows[0]) await writeLabMediaEvent(id, "media_job_submitting", result.rows[0].owner_id, { attempt: result.rows[0].attempt_count });
  return result.rows[0] || null;
}

export async function claimLabVideoRefresh(id: string) {
  const token = randomUUID();
  const result = await database().query<LabMediaJob>(
    `UPDATE production_lab_media_jobs SET lease_token=$2,lease_expires_at=now()+interval '90 seconds',
       next_poll_at=now()+interval '15 seconds',updated_at=now()
     WHERE id=$1 AND provider_request_id IS NOT NULL AND lease_token IS NULL AND lease_expires_at IS NULL
       AND next_poll_at<=now()
       AND (status IN ('queued','running') OR (status='succeeded' AND output->>'archivePending'='true'))
     RETURNING *`,
    [id, token],
  );
  return result.rows[0] || null;
}

export async function createLabAsset(asset: NewLabAsset) {
  const result = await database().query<LabAsset>(
    `INSERT INTO production_lab_assets
      (id,owner_id,project_id,episode,scope,category,name,character_name,style,view_label,media_kind,storage_path,mime_type,bytes,media_job_id,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     RETURNING *`,
    [asset.id, asset.owner_id, asset.project_id, asset.episode, asset.scope, asset.category, asset.name, asset.character_name,
      asset.style, asset.view_label, asset.media_kind, asset.storage_path, asset.mime_type, asset.bytes, asset.media_job_id,
      JSON.stringify(asset.metadata)],
  );
  return result.rows[0];
}

export async function findLabAsset(id: string) {
  const result = await database().query<LabAsset>("SELECT * FROM production_lab_assets WHERE id=$1", [id]);
  return result.rows[0] || null;
}

export async function listLabAssets(input: { projectId?: string | null; scope?: LabAssetScope | null; limit?: number }) {
  const result = await database().query<LabAsset>(
    `SELECT * FROM production_lab_assets
     WHERE ($1::text IS NULL OR scope='official' OR project_id=$1)
       AND ($2::text IS NULL OR scope=$2)
     ORDER BY created_at DESC LIMIT $3`,
    [input.projectId || null, input.scope || null, Math.max(1, Math.min(input.limit || 300, 500))],
  );
  return result.rows;
}

export async function listLabMediaJobs(projectId: string, episode: number, limit = 50) {
  const result = await database().query<LabMediaJob>(
    "SELECT * FROM production_lab_media_jobs WHERE project_id=$1 AND episode=$2 ORDER BY created_at DESC LIMIT $3",
    [projectId, episode, Math.max(1, Math.min(limit, 100))],
  );
  return result.rows;
}

export async function findLabMediaJob(id: string) {
  const result = await database().query<LabMediaJob>("SELECT * FROM production_lab_media_jobs WHERE id=$1", [id]);
  return result.rows[0] || null;
}

export async function recoverExpiredLabMediaSubmissions() {
  const submissions = await database().query(
    `UPDATE production_lab_media_jobs SET status='unknown',lease_token=NULL,lease_expires_at=NULL,
      error='生成提交过程超过保护时限，结果可能未知；先在 WeToken 后台按 Reference ID 核对，不要直接重试。',updated_at=now()
     WHERE status='submitting' AND lease_expires_at<now()`,
  );
  const polls = await database().query(
    `UPDATE production_lab_media_jobs SET lease_token=NULL,lease_expires_at=NULL,next_poll_at=now(),updated_at=now()
     WHERE provider_request_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at<now()
       AND (status IN ('queued','running') OR (status='succeeded' AND output->>'archivePending'='true'))`,
  );
  return { submissions: submissions.rowCount || 0, polls: polls.rowCount || 0 };
}
