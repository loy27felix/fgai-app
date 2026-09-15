import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { claimNextMediaJob, MediaWorkerQueueError } from "@/lib/creator/media-worker-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const result = await claimNextMediaJob(worker);
    return NextResponse.json({ job: result?.job || null, leaseToken: result?.leaseToken || null });
  } catch (error) {
    if (error instanceof MediaWorkerAuthError || error instanceof MediaWorkerQueueError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "领取媒体任务失败，请稍后重试", code: "MEDIA_JOB_CLAIM_FAILED" }, { status: 500 });
  }
}

