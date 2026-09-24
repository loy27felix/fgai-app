import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getImageModel, imageOutputSizeOptionsFor } from "@/lib/imageModels";
import { getVideoModel } from "@/lib/ai/video";
import { estimateImagePrice, estimateVideoPrice } from "@/lib/usage/pricing";
import { assertMonthlyBudgetAvailable } from "@/lib/usage/budget";
import { labActor } from "@/lib/production-lab/access";
import { readLab } from "@/lib/production-lab/store";
import { readProjectCanvas, validateCanvasGraph } from "@/lib/production-lab/canvas-storage";
import { createLabMediaJob, listLabMediaJobs } from "@/lib/production-lab/media-store";
import { findUsageLedgerRows, refreshLabVideoJob, submitLabMediaJob, wakeLabMediaQueue } from "@/lib/production-lab/media-runner";
import { database } from "@/lib/production-lab/store";
import { resolveLabMediaAccounting } from "@/lib/production-lab/media-accounting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function jobView(job: any, ledger?: Record<string, unknown>) {
  const output = job.output && typeof job.output === "object" ? job.output : {};
  const assetId = typeof output.assetId === "string" ? output.assetId : null;
  const accounting = resolveLabMediaAccounting(job.provider_request_id, ledger, job.estimated_cost_usd, job.reported_cost_usd, job.accounting_error);
  return {
    id: job.id, projectId: job.project_id, episode: job.episode, nodeId: job.node_id,
    kind: job.kind, status: job.status, model: job.model, providerRequestId: job.provider_request_id,
    request: job.request, output: { assetId, mimeType: output.mimeType || null, bytes: output.bytes || null, archivePending: output.archivePending === true, providerStatus: output.providerStatus || null, usage: output.usage || null },
    assetUrl: assetId ? `/api/production-lab/assets/${encodeURIComponent(assetId)}/content` : null,
    error: job.error, accountingError: job.accounting_error,
    estimateUsd: accounting.estimateUsd,
    reportedUsd: accounting.reportedUsd,
    settledUsd: accounting.settledUsd,
    costSource: ledger?.cost_source ?? job.cost_source,
    ledgerStatus: accounting.ledgerStatus,
    accountingStatus: accounting.status,
    createdAt: job.created_at, updatedAt: job.updated_at, completedAt: job.completed_at,
  };
}

async function authorizedProject(actorId: string, reviewer: boolean, projectId: string) {
  const state = await readLab();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return { state, project: null, status: 404 };
  if (project.ownerId !== actorId && !reviewer) return { state, project: null, status: 403 };
  return { state, project, status: 200 };
}

export async function GET(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  const episode = Number(url.searchParams.get("episode"));
  if (!projectId || projectId.length > 100 || !Number.isInteger(episode) || episode < 1 || episode > 200) return NextResponse.json({ error: "请指定项目和分集" }, { status: 400 });
  try {
    const access = await authorizedProject(actor.id, actor.reviewer, projectId);
    if (!access.project) return NextResponse.json({ error: access.status === 403 ? "无权访问此制作项目" : "制作项目不存在" }, { status: access.status });
    await wakeLabMediaQueue(projectId, episode);
    let jobs = await listLabMediaJobs(projectId, episode, 50);
    await Promise.allSettled(jobs.filter(job => job.kind === "video" && (job.status === "queued" || job.status === "running" || (job.status === "succeeded" && job.output.archivePending === true))).slice(0, 5).map(job => refreshLabVideoJob(job.id)));
    jobs = await listLabMediaJobs(projectId, episode, 50);
    const ledger = await findUsageLedgerRows(jobs.map(job => job.request_id));
    return NextResponse.json({ jobs: jobs.map(job => jobView(job, ledger.get(job.request_id))) });
  } catch {
    return NextResponse.json({ error: "读取试用队列失败；请确认独立数据库迁移和费用账本连接" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  if (!process.env.WETOKEN_API_KEY) return NextResponse.json({ error: "服务端尚未配置 WeToken API Key；未创建任务，也未产生费用" }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const episode = Number(body.episode);
  const kind = body.kind;
  const model = typeof body.model === "string" ? body.model : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const nodeId = typeof body.nodeId === "string" ? body.nodeId : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const referenceAssetIds = Array.isArray(body.referenceAssetIds) && body.referenceAssetIds.every((id) => typeof id === "string") ? [...new Set(body.referenceAssetIds as string[])] : [];
  if (!projectId || projectId.length > 100 || !Number.isInteger(episode) || episode < 1 || episode > 200) return NextResponse.json({ error: "请指定制作项目与有效分集" }, { status: 400 });
  if (kind !== "image" && kind !== "video") return NextResponse.json({ error: "生成类型无效" }, { status: 400 });
  if (!prompt || prompt.length > 10000) return NextResponse.json({ error: "请填写 1–10000 字的生成描述" }, { status: 400 });
  if (!/^[a-zA-Z0-9:_-]{16,120}$/.test(idempotencyKey)) return NextResponse.json({ error: "任务编号无效，请重新提交" }, { status: 400 });
  if (referenceAssetIds.length > 9 || referenceAssetIds.some((id) => id.length > 100)) return NextResponse.json({ error: "参考素材数量或编号无效" }, { status: 400 });

  let access;
  try { access = await authorizedProject(actor.id, actor.reviewer, projectId); }
  catch { return NextResponse.json({ error: "独立制作数据库暂时不可用" }, { status: 503 }); }
  if (!access.project) return NextResponse.json({ error: access.status === 403 ? "无权访问此制作项目" : "制作项目不存在" }, { status: access.status });
  const task = access.state.tasks.find((item) => item.projectId === projectId && item.episode === episode);
  if (kind === "video" && (!["样片制作", "批量制作"].includes(access.project.stage) || task?.status !== "已通过")) {
    return NextResponse.json({ error: "视频任务需关联已通过审核的分集，并由项目进入样片制作或批量制作阶段" }, { status: 409 });
  }
  if (nodeId) {
    try {
      const canvas = await readProjectCanvas(projectId, episode);
      const graph = canvas ? validateCanvasGraph(canvas.document) : null;
      if (!graph?.nodes.some((node) => node.id === nodeId)) return NextResponse.json({ error: "目标画布节点不存在或尚未同步" }, { status: 409 });
    } catch { return NextResponse.json({ error: "无法校验目标画布节点" }, { status: 503 }); }
  }

  let pricing;
  let settings: Record<string, unknown>;
  if (kind === "image") {
    const spec = getImageModel(model);
    const size = typeof body.size === "string" ? body.size : "1K";
    if (!spec || !imageOutputSizeOptionsFor(model).includes(size)) return NextResponse.json({ error: "图片模型或尺寸不支持" }, { status: 400 });
    if (referenceAssetIds.length > Math.min(4, spec.maxReferences)) return NextResponse.json({ error: `参考图最多 ${Math.min(4, spec.maxReferences)} 张` }, { status: 400 });
    settings = { prompt, size, title: typeof body.title === "string" ? body.title.slice(0, 160) : "生成图片", style: typeof body.style === "string" ? body.style.slice(0, 100) : "待标注", targetKind: ["character", "scene", "shot"].includes(String(body.targetKind)) ? body.targetKind : "character", referenceAssetIds };
    pricing = estimateImagePrice(model, size, { prompt, referenceCount: referenceAssetIds.length });
  } else {
    const spec = getVideoModel(model);
    const duration = Number(body.duration);
    const resolution = typeof body.resolution === "string" ? body.resolution : "720p";
    const ratio = typeof body.ratio === "string" ? body.ratio : "9:16";
    if (!spec || !Number.isInteger(duration) || duration < spec.minDuration || duration > spec.maxDuration || !spec.resolutions.includes(resolution) || !spec.ratios.includes(ratio)) return NextResponse.json({ error: "视频模型、时长、比例或分辨率不支持" }, { status: 400 });
    if (referenceAssetIds.length < spec.minImageReferences || referenceAssetIds.length > spec.maxImageReferences) return NextResponse.json({ error: `此模型要求 ${spec.minImageReferences}–${spec.maxImageReferences} 张图片参考` }, { status: 400 });
    settings = { prompt, duration, resolution, ratio, generateAudio: body.generateAudio !== false, title: typeof body.title === "string" ? body.title.slice(0, 160) : "分集视频", style: typeof body.style === "string" ? body.style.slice(0, 100) : "待标注", referenceAssetIds };
    pricing = estimateVideoPrice({ model, duration, resolution, ratio, imageReferenceCount: referenceAssetIds.length });
  }

  if (referenceAssetIds.length) {
    try {
      const found = await database().query<{ id: string }>("SELECT id FROM production_lab_assets WHERE id=ANY($1::uuid[]) AND (scope='official' OR project_id=$2)", [referenceAssetIds, projectId]);
      if (found.rows.length !== referenceAssetIds.length) return NextResponse.json({ error: "有参考素材不存在或不属于当前故事" }, { status: 400 });
      const kinds = await database().query<{ media_kind: string }>("SELECT media_kind FROM production_lab_assets WHERE id=ANY($1::uuid[])", [referenceAssetIds]);
      if (kinds.rows.some((row) => row.media_kind !== "image")) return NextResponse.json({ error: "当前版本的生成模型仅接受图片参考" }, { status: 400 });
    } catch { return NextResponse.json({ error: "读取团队云端素材失败；请先完成素材库迁移" }, { status: 503 }); }
  }

  const budget = await assertMonthlyBudgetAvailable({ userId: actor.id, estimatedCostUsd: pricing?.estimatedCostUsd });
  if (!budget.allowed) return NextResponse.json({ error: budget.message, code: budget.code }, { status: 402 });
  const id = randomUUID();
  try {
    const created = await createLabMediaJob({ id, ownerId: actor.id, projectId, episode, nodeId, kind, idempotencyKey, model, request: settings, estimatedCostUsd: pricing?.estimatedCostUsd });
    if (!created.replayed) void submitLabMediaJob(created.job.id).catch(() => undefined);
    return NextResponse.json({ ok: true, replayed: created.replayed, job: jobView(created.job), estimate: pricing ? { amountUsd: pricing.estimatedCostUsd, note: pricing.snapshot.note } : null }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建媒体任务失败" }, { status: 503 });
  }
}
