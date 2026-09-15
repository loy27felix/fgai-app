import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { reportMediaProgress, MediaWorkerQueueError } from "@/lib/creator/media-worker-queue";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ job: await reportMediaProgress(worker, params.id, typeof body.leaseToken === "string" ? body.leaseToken : "", Number(body.progress), body.phase) });
  } catch (error) {
    if (error instanceof MediaWorkerAuthError || error instanceof MediaWorkerQueueError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "任务进度更新失败，请稍后重试", code: "MEDIA_JOB_PROGRESS_FAILED" }, { status: 500 });
  }
}

