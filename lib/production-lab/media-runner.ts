import { randomUUID } from "node:crypto";
import { createWetokenVideoTask, getWetokenVideoTask, isDefinitiveWetokenVideoRejection, type SeedanceInput, type VideoReference } from "@/lib/ai/video";
import { generateWetokenImage, providerRequestIdFromImageDiagnostic, WetokenImageRequestError, WetokenImageResultError, WetokenImageTransportError } from "@/lib/ai/image";
import { isProviderReachableAssetSourceUrl, WetokenAssetError } from "@/lib/ai/wetoken-assets";
import { localStorage, readLocalFile } from "@/lib/local/storage";
import { buildImageLedgerEntry, buildVideoLedgerEntry, recordUsageRequired, updateVideoUsageBestEffort } from "@/lib/usage/ledger";
import { estimateImagePrice, estimateImageUsagePrice, estimateVideoPrice, extractReportedCostUsd } from "@/lib/usage/pricing";
import { createAdminClient } from "@/lib/local/admin";
import { database } from "./store";
import { claimLabMediaSubmission, claimLabVideoRefresh, createLabAsset, findLabMediaJob, PRODUCTION_LAB_ASSET_BUCKET, recoverExpiredLabMediaSubmissions, updateLabMediaJob, writeLabMediaEvent, type LabAsset, type LabMediaJob } from "./media-store";

const MAX_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 320 * 1024 * 1024;

async function readLimitedResponse(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("成片超过云端存储上限");
  if (!response.body) throw new Error("WeToken 成片响应为空");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("成片超过云端存储上限");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

async function fetchProviderVideo(url: string) {
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!isProviderReachableAssetSourceUrl(current)) throw new Error("WeToken 返回的成片链接不是安全的公网 HTTPS 地址");
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 4) throw new Error("WeToken 成片下载地址跳转失败");
    current = new URL(location, current).toString();
  }
  throw new Error("WeToken 成片下载地址跳转过多");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeMessage(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message.replace(/[\u0000\r\n]/g, " ").slice(0, 400) : fallback;
}

function extensionFor(mime: string, kind: "image" | "video") {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "video/webm") return "webm";
  return kind === "image" ? "png" : "mp4";
}

function safeUsage(value: unknown) {
  const usage = record(value);
  const result: Record<string, number | string> = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "promptTokenCount", "candidatesTokenCount", "totalTokenCount", "input_tokens", "output_tokens"]) {
    const candidate = usage[key];
    if ((typeof candidate === "number" && Number.isFinite(candidate)) || typeof candidate === "string") result[key] = candidate as number | string;
  }
  return result;
}

async function labAssetsFor(job: LabMediaJob, ids: string[]) {
  if (!ids.length) return [] as LabAsset[];
  const rows = await database().query<LabAsset>(
    "SELECT * FROM production_lab_assets WHERE id=ANY($1::uuid[]) AND (scope='official' OR project_id=$2)",
    [ids, job.project_id],
  );
  if (rows.rows.length !== ids.length) throw new Error("有参考素材不存在或不属于当前故事");
  return rows.rows;
}

async function imageReferences(job: LabMediaJob) {
  const ids = Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds.filter((id): id is string => typeof id === "string") : [];
  const assets = await labAssetsFor(job, ids);
  return Promise.all(assets.map(async (asset) => {
    if (asset.media_kind !== "image") throw new Error("图片生成只接受图片参考素材");
    if (Number(asset.bytes) > MAX_IMAGE_REFERENCE_BYTES) throw new Error("图片参考素材不能超过 10 MB");
    const bytes = await readLocalFile(PRODUCTION_LAB_ASSET_BUCKET, asset.storage_path);
    return { data: bytes.toString("base64"), mimeType: asset.mime_type };
  }));
}

async function videoReferences(job: LabMediaJob, model: string): Promise<VideoReference[]> {
  const ids = Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds.filter((id): id is string => typeof id === "string") : [];
  const assets = await labAssetsFor(job, ids);
  return Promise.all(assets.map(async (asset) => {
    if (asset.media_kind !== "image") throw new Error("当前制作面板先支持图片转视频参考");
    const signed = await localStorage(PRODUCTION_LAB_ASSET_BUCKET).createProviderSignedUrl(asset.storage_path, 900);
    const url = signed.data?.signedUrl || "";
    if (!isProviderReachableAssetSourceUrl(url)) throw new Error("视频模型需要可从公网读取的 HTTPS 素材地址；请先配置 PROVIDER_MEDIA_URL");
    const role = model.includes("i2v") ? "first_frame" : "reference_image";
    return { type: "image", url, role } as VideoReference;
  }));
}

async function writeImageUsage(job: LabMediaJob, providerRequestId: string | undefined, usage: unknown, durationMs: number, unknown = false) {
  const pricing = estimateImageUsagePrice({ model: job.model, resolution: String(job.request.size || "1K"), prompt: String(job.request.prompt || ""), referenceCount: Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds.length : 0, usage })
    || estimateImagePrice(job.model, String(job.request.size || "1K"), { prompt: String(job.request.prompt || ""), referenceCount: Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds.length : 0 });
  const reportedCostUsd = extractReportedCostUsd(usage);
  const entry = buildImageLedgerEntry({
    requestId: job.request_id,
    providerRequestId,
    userId: job.owner_id,
    provider: "wetoken",
    model: job.model,
    resolution: String(job.request.size || "1K"),
    pricing,
    reportedCostUsd,
    durationMs,
  });
  await recordUsageRequired(unknown ? { ...entry, status: "unknown" } : entry);
  return { pricing, reportedCostUsd };
}

function imageFailure(error: unknown) {
  if (error instanceof WetokenImageRequestError) {
    if (error.status >= 400 && error.status < 500 && error.status !== 408) return { status: "failed" as const, error: error.publicMessage };
    return { status: "unknown" as const, error: "图片请求结果不确定；请先检查 WeToken 账单，不要直接重复提交。" };
  }
  if (error instanceof WetokenImageTransportError || error instanceof WetokenImageResultError) {
    return { status: "unknown" as const, error: "图片请求结果不确定；请先检查 WeToken 账单，不要直接重复提交。" };
  }
  return { status: "failed" as const, error: safeMessage(error, "图片生成未提交") };
}

export async function submitLabMediaJob(id: string) {
  const job = await claimLabMediaSubmission(id);
  if (!job || !job.lease_token) return;
  const lease = job.lease_token;
  const startedAt = Date.now();
  try {
    if (job.kind === "image") {
      await submitLabImage(job, lease, startedAt);
      return;
    }
    await submitLabVideo(job, lease);
  } catch {
    const current = await findLabMediaJob(job.id).catch(() => null);
    if (current?.provider_request_id) {
      const stillSubmittable = current.status === "submitting";
      await updateLabMediaJob(job.id, {
        ...(stillSubmittable ? { status: "running" } : {}),
        error: "WeToken 已返回任务编号，但后续记录暂未完成；系统会继续查询此任务，不会重新提交。",
        leaseToken: null,
        leaseExpiresAt: null,
        nextPollAt: new Date(Date.now() + 15_000).toISOString(),
      }, lease);
      await writeLabMediaEvent(job.id, "media_job_post_submit_recovery", job.owner_id, { kind: job.kind });
    } else {
      await updateLabMediaJob(job.id, { status: "unknown", error: "提交结果无法确认；请先在 WeToken 账单中核对，不要直接重复提交。", leaseToken: null, leaseExpiresAt: null }, lease);
      await writeLabMediaEvent(job.id, "media_job_submission_unknown", job.owner_id, { kind: job.kind });
    }
  }
}

async function submitLabImage(job: LabMediaJob, lease: string, startedAt: number) {
  let generated;
  let providerRequestId: string | undefined;
  let references: Awaited<ReturnType<typeof imageReferences>>;
  try {
    references = await imageReferences(job);
  } catch (error) {
    await updateLabMediaJob(job.id, { status: "failed", error: safeMessage(error, "读取图片参考素材失败"), leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    await writeLabMediaEvent(job.id, "media_job_failed_before_submit", job.owner_id, { kind: "image" });
    return;
  }
  try {
    generated = await generateWetokenImage({
      model: job.model,
      prompt: String(job.request.prompt || ""),
      size: String(job.request.size || "1K"),
      references,
      trace: { requestId: job.request_id, traceId: job.id },
    });
    providerRequestId = providerRequestIdFromImageDiagnostic(generated.providerDiagnostic) || undefined;
  } catch (error) {
    if (error instanceof WetokenImageResultError) providerRequestId = providerRequestIdFromImageDiagnostic(error.diagnostic) || undefined;
    const failure = imageFailure(error);
    let accountingError: string | null = null;
    try {
      const estimate = estimateImagePrice(job.model, String(job.request.size || "1K"), { prompt: String(job.request.prompt || ""), referenceCount: Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds.length : 0 });
      const entry = buildImageLedgerEntry({ requestId: job.request_id, providerRequestId, userId: job.owner_id, provider: "wetoken", model: job.model, resolution: String(job.request.size || "1K"), pricing: estimate, durationMs: Date.now() - startedAt });
      await recordUsageRequired({ ...entry, status: failure.status });
    } catch (ledgerError) { accountingError = safeMessage(ledgerError, "用量账本写入失败"); }
    await updateLabMediaJob(job.id, { status: failure.status, error: failure.error, accountingError, providerRequestId: providerRequestId || null, leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    await writeLabMediaEvent(job.id, failure.status === "failed" ? "media_job_failed" : "media_job_unknown", job.owner_id, { kind: "image", accountingError: Boolean(accountingError) });
    return;
  }

  let accountingError: string | null = null;
  let pricing;
  let reportedCostUsd: number | undefined;
  const usage = generated.usage;
  try {
    const ref = providerRequestId ? providerRequestId : undefined;
    ({ pricing, reportedCostUsd } = await writeImageUsage(job, ref, usage, Date.now() - startedAt, !ref));
    if (!ref) accountingError = "WeToken 未返回可核对的 Reference ID；请在费用页检查未分配账单";
  } catch (error) { accountingError = safeMessage(error, "用量账本写入失败"); }

  const ext = extensionFor(generated.mimeType, "image");
  const assetId = randomUUID();
  const storagePath = "generated/" + job.project_id + "/" + job.episode + "/" + assetId + "." + ext;
  const upload = await localStorage(PRODUCTION_LAB_ASSET_BUCKET).upload(storagePath, generated.bytes, { upsert: false, contentType: generated.mimeType });
  if (upload.error) {
    await updateLabMediaJob(job.id, { status: "failed", error: "图片已生成，但保存到团队云端素材库失败。请联系管理员检查 NAS；费用已写入对账记录。", accountingError, providerRequestId: providerRequestId || null, reportedCostUsd: reportedCostUsd ?? null, costSource: reportedCostUsd === undefined ? (job.estimated_cost_usd ? "estimated" : "unknown") : "reported", leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    return;
  }
  try {
    const asset = await createLabAsset({
      id: assetId, owner_id: job.owner_id, project_id: job.project_id, episode: job.episode, scope: "story",
      category: ({ character: "角色设定", scene: "场景", shot: "镜头参考" } as Record<string, string>)[String(job.request.targetKind)] || "角色设定", name: String(job.request.title || "生成图片"),
      character_name: String(job.request.title || "生成图片"), style: String(job.request.style || "待标注"), view_label: "AI 生成",
      media_kind: "image", storage_path: storagePath, mime_type: generated.mimeType, bytes: generated.bytes.byteLength,
      media_job_id: job.id, metadata: { model: job.model, providerRequestId: providerRequestId || null },
    });
    const output = { assetId: asset.id, mimeType: asset.mime_type, bytes: Number(asset.bytes), archivePending: false, usage: safeUsage(usage) };
    await updateLabMediaJob(job.id, { status: "succeeded", output, error: null, accountingError, providerRequestId: providerRequestId || null, reportedCostUsd: reportedCostUsd ?? null, costSource: reportedCostUsd === undefined ? (pricing ? "estimated" : "unknown") : "reported", leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    await writeLabMediaEvent(job.id, "media_job_succeeded", job.owner_id, { kind: "image", model: job.model, bytes: generated.bytes.byteLength });
  } catch {
    await localStorage(PRODUCTION_LAB_ASSET_BUCKET).remove([storagePath]);
    await updateLabMediaJob(job.id, { status: "failed", error: "图片已生成，但素材索引写入失败。请联系管理员恢复素材记录。", accountingError, providerRequestId: providerRequestId || null, leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
  }
}

async function submitLabVideo(job: LabMediaJob, lease: string) {
  const request = job.request;
  let references: VideoReference[];
  try {
    references = await videoReferences(job, job.model);
  } catch (error) {
    await updateLabMediaJob(job.id, { status: "failed", error: safeMessage(error, "读取视频参考素材失败"), leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    await writeLabMediaEvent(job.id, "media_job_failed_before_submit", job.owner_id, { kind: "video", model: job.model });
    return;
  }
  const input: SeedanceInput = {
    model: job.model,
    prompt: String(request.prompt || ""),
    references,
    duration: Number(request.duration),
    ratio: String(request.ratio || "9:16"),
    resolution: String(request.resolution || "720p"),
    watermark: false,
    generateAudio: request.generateAudio !== false,
  };
  let created;
  try {
    created = await createWetokenVideoTask(input, { taskId: job.id, traceId: job.id, idempotencyKey: job.request_id });
  } catch (error) {
    if (isDefinitiveWetokenVideoRejection(error) || (error instanceof WetokenAssetError && error.status >= 400 && error.status < 500)) {
      const message = error instanceof Error ? error.message.slice(0, 400) : "视频任务被服务端拒绝";
      await updateLabMediaJob(job.id, { status: "failed", error: message, leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
      await writeLabMediaEvent(job.id, "media_job_failed", job.owner_id, { kind: "video", model: job.model });
    } else {
      await updateLabMediaJob(job.id, { status: "unknown", error: "视频提交可能已被 WeToken 受理，但未能确认任务编号。先查 WeToken 账单，不要直接重试。", leaseToken: null, leaseExpiresAt: null }, lease);
      await writeLabMediaEvent(job.id, "media_job_submission_unknown", job.owner_id, { kind: "video", model: job.model });
    }
    return;
  }

  const completedAt = ["succeeded", "failed", "expired"].includes(created.status) ? new Date().toISOString() : null;
  const initialStatus = created.status === "expired" ? "failed" : created.status;
  await updateLabMediaJob(job.id, {
    status: initialStatus,
    providerRequestId: created.externalTaskId,
    output: { providerStatus: created.status, archivePending: created.status === "succeeded", usage: safeUsage(record(created.raw).usage) },
    error: created.status === "failed" || created.status === "expired" ? "WeToken 视频任务未完成" : null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextPollAt: completedAt ? new Date().toISOString() : new Date(Date.now() + 5_000).toISOString(),
    completedAt,
  }, lease);
  await writeLabMediaEvent(job.id, "media_job_provider_accepted", job.owner_id, { kind: "video", model: job.model, providerStatus: created.status });

  const pricing = estimateVideoPrice({ model: job.model, duration: input.duration, resolution: input.resolution, ratio: input.ratio, imageReferenceCount: input.references.filter(reference => reference.type === "image").length });
  const reportedCostUsd = extractReportedCostUsd(created.raw);
  let accountingError: string | null = null;
  try {
    await recordUsageRequired(buildVideoLedgerEntry({
      requestId: job.request_id,
      providerRequestId: created.externalTaskId,
      userId: job.owner_id,
      provider: "wetoken",
      model: job.model,
      duration: input.duration,
      resolution: input.resolution,
      generateAudio: input.generateAudio,
      pricing,
      reportedCostUsd,
    }));
    if (created.status !== "running" && created.status !== "queued") {
      await updateVideoUsageBestEffort({ requestId: job.request_id, providerRequestId: created.externalTaskId, providerStatus: created.status, completedAt, reportedCostUsd, priceSnapshot: pricing?.snapshot });
    }
  } catch (error) { accountingError = safeMessage(error, "用量账本写入失败"); }
  await updateLabMediaJob(job.id, {
    accountingError,
    reportedCostUsd: reportedCostUsd ?? null,
    costSource: reportedCostUsd === undefined ? (pricing ? "estimated" : "unknown") : "reported",
  });
}

async function archiveVideo(job: LabMediaJob, lease: string, videoUrl: string, usage?: unknown) {
  const response = await fetchProviderVideo(videoUrl);
  if (!response.ok) throw new Error("读取 WeToken 成片失败（HTTP " + response.status + "）");
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
  if (!mimeType.startsWith("video/")) throw new Error("WeToken 返回的成片类型无效");
  const bytes = await readLimitedResponse(response, MAX_VIDEO_BYTES);
  if (!bytes.length || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("成片为空或超过云端存储上限");
  const assetId = randomUUID();
  const storagePath = "generated/" + job.project_id + "/" + job.episode + "/" + assetId + "." + extensionFor(mimeType, "video");
  const upload = await localStorage(PRODUCTION_LAB_ASSET_BUCKET).upload(storagePath, bytes, { upsert: false, contentType: mimeType });
  if (upload.error) throw new Error("保存成片到团队云端素材库失败");
  try {
    const asset = await createLabAsset({
      id: assetId, owner_id: job.owner_id, project_id: job.project_id, episode: job.episode, scope: "story",
      category: "video", name: String(job.request.title || "EP" + job.episode + " 生成视频"),
      character_name: "", style: String(job.request.style || "待标注"), view_label: "视频生成",
      media_kind: "video", storage_path: storagePath, mime_type: mimeType, bytes: bytes.byteLength,
      media_job_id: job.id, metadata: { model: job.model, providerRequestId: job.provider_request_id },
    });
    await updateLabMediaJob(job.id, { status: "succeeded", output: { assetId: asset.id, mimeType, bytes: bytes.byteLength, archivePending: false, usage: safeUsage(usage) }, error: null, leaseToken: null, leaseExpiresAt: null, completedAt: new Date().toISOString() }, lease);
    await writeLabMediaEvent(job.id, "media_job_archived", job.owner_id, { kind: "video", bytes: bytes.byteLength });
  } catch (error) {
    await localStorage(PRODUCTION_LAB_ASSET_BUCKET).remove([storagePath]);
    throw error;
  }
}

export async function refreshLabVideoJob(id: string) {
  const current = await findLabMediaJob(id);
  if (!current) return null;
  const claimed = await claimLabVideoRefresh(id);
  if (!claimed || !claimed.lease_token) return current;
  const lease = claimed.lease_token;
  try {
    const result = await getWetokenVideoTask(claimed.provider_request_id!, { model: claimed.model, taskId: claimed.id, traceId: claimed.id });
    const terminal = ["succeeded", "failed", "expired"].includes(result.status);
    const completedAt = terminal ? new Date().toISOString() : null;
    const reportedCostUsd = extractReportedCostUsd(result.usage);
    if (result.status === "succeeded") {
      await updateLabMediaJob(id, { status: "succeeded", output: { ...claimed.output, providerStatus: result.status, usage: safeUsage(result.usage), archivePending: true }, error: null, reportedCostUsd: reportedCostUsd ?? null, costSource: reportedCostUsd === undefined ? claimed.cost_source : "reported", completedAt, nextPollAt: new Date(Date.now() + 30_000).toISOString() }, lease);
      const pricing = estimateVideoPrice({ model: claimed.model, duration: Number(claimed.request.duration), resolution: String(claimed.request.resolution || "720p"), ratio: String(claimed.request.ratio || "9:16"), imageReferenceCount: Array.isArray(claimed.request.referenceAssetIds) ? claimed.request.referenceAssetIds.length : 0 });
      await updateVideoUsageBestEffort({ requestId: claimed.request_id, providerRequestId: result.externalTaskId, providerStatus: result.status, completedAt, reportedCostUsd, priceSnapshot: pricing?.snapshot });
      if (!result.videoUrl) {
        await updateLabMediaJob(id, { error: "WeToken 已报告任务完成，但尚未返回可下载的成片地址；系统会继续查询，不会重新生成。", leaseToken: null, leaseExpiresAt: null }, lease);
        await writeLabMediaEvent(id, "media_job_archive_pending", claimed.owner_id, { kind: "video", reason: "missing_download_url" });
        return findLabMediaJob(id);
      }
      try { await archiveVideo(claimed, lease, result.videoUrl, result.usage); }
      catch (error) {
        await updateLabMediaJob(id, { error: safeMessage(error, "视频已生成，但云端存储暂未完成"), leaseToken: null, leaseExpiresAt: null, nextPollAt: new Date(Date.now() + 30_000).toISOString() }, lease);
        await writeLabMediaEvent(id, "media_job_archive_pending", claimed.owner_id, { kind: "video" });
      }
      return findLabMediaJob(id);
    }
    const failed = result.status === "failed" || result.status === "expired";
    const status = failed ? "failed" : "running";
    const patch = { status, output: { ...claimed.output, providerStatus: result.status, usage: safeUsage(result.usage) }, error: failed ? (result.error || "WeToken 视频生成失败") : null, reportedCostUsd: reportedCostUsd ?? null, costSource: reportedCostUsd === undefined ? claimed.cost_source : "reported", leaseToken: null, leaseExpiresAt: null, completedAt, nextPollAt: new Date(Date.now() + (failed ? 0 : 15_000)).toISOString() };
    await updateLabMediaJob(id, patch, lease);
    const pricing = estimateVideoPrice({ model: claimed.model, duration: Number(claimed.request.duration), resolution: String(claimed.request.resolution || "720p"), ratio: String(claimed.request.ratio || "9:16"), imageReferenceCount: Array.isArray(claimed.request.referenceAssetIds) ? claimed.request.referenceAssetIds.length : 0 });
    await updateVideoUsageBestEffort({ requestId: claimed.request_id, providerRequestId: result.externalTaskId, providerStatus: result.status, completedAt, reportedCostUsd, priceSnapshot: pricing?.snapshot });
    if (failed) await writeLabMediaEvent(id, "media_job_failed", claimed.owner_id, { kind: "video", providerStatus: result.status });
  } catch {
    await updateLabMediaJob(id, { error: "WeToken 状态暂时无法读取；队列会稍后重试查询，不会重新提交生成。", leaseToken: null, leaseExpiresAt: null, nextPollAt: new Date(Date.now() + 30_000).toISOString() }, lease);
  }
  return findLabMediaJob(id);
}

export async function wakeLabMediaQueue(projectId: string, episode: number) {
  await recoverExpiredLabMediaSubmissions();
  const { rows } = await database().query<LabMediaJob>(
    "SELECT id,kind FROM production_lab_media_jobs WHERE project_id=$1 AND episode=$2 AND status='queued' ORDER BY created_at ASC LIMIT 10",
    [projectId, episode],
  );
  for (const row of rows) void submitLabMediaJob(row.id).catch(() => undefined);
}

export async function findUsageLedgerRows(requestIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!requestIds.length) return new Map<string, Record<string, unknown>>();
  const { data, error } = await createAdminClient().from("ai_usage_ledger")
    .select("request_id,provider_request_id,reported_cost_usd,estimated_cost_usd,cost_source,status,price_snapshot,completed_at")
    .in("request_id", requestIds);
  if (error) throw new Error("读取 WeToken 用量账本失败");
  return new Map((data || []).map((row: Record<string, unknown>) => [String(row.request_id), row]));
}
