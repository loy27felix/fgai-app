import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { createMediaJob, listMediaJobs, MediaWorkerQueueError } from "@/lib/creator/media-worker-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: string, code: string, status: number) { return NextResponse.json({ error, code }, { status }); }

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  if (!mediaWorkerEnabled()) return errorResponse("本地 Worker 功能尚未启用", "MEDIA_WORKER_DISABLED", 503);
  const body = await request.json().catch(() => ({}));
  try {
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId) return errorResponse("缺少创作空间", "WORKSPACE_REQUIRED", 400);
    const result = await createMediaJob(user.id, workspaceId, {
      operation: body.operation,
      sourceAssetId: body.sourceAssetId,
      maskAssetId: body.maskAssetId,
      targetResolution: body.targetResolution,
      modelProfile: body.modelProfile,
      idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof MediaWorkerQueueError) return errorResponse(error.message, error.code, error.status);
    return errorResponse("媒体任务创建失败，请稍后重试", "MEDIA_JOB_CREATE_FAILED", 500);
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  if (!mediaWorkerEnabled()) return NextResponse.json({ enabled: false, jobs: [] });
  const url = new URL(request.url);
  const jobs = await listMediaJobs(user.id, { workspaceId: url.searchParams.get("workspaceId") || undefined });
  return NextResponse.json({ enabled: true, jobs });
}

