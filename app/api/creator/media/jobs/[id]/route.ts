import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { cancelMediaJob, getMediaJob, MediaWorkerQueueError } from "@/lib/creator/media-worker-queue";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  const job = await getMediaJob(user.id, params.id);
  if (!job) return NextResponse.json({ error: "媒体任务不存在", code: "MEDIA_JOB_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    return NextResponse.json({ job: await cancelMediaJob(user.id, params.id) });
  } catch (error) {
    if (error instanceof MediaWorkerQueueError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "取消媒体任务失败，请稍后重试", code: "MEDIA_JOB_CANCEL_FAILED" }, { status: 500 });
  }
}

