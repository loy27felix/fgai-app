import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { heartbeatMediaJob, MediaWorkerQueueError } from "@/lib/creator/media-worker-queue";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ job: await heartbeatMediaJob(worker, params.id, typeof body.leaseToken === "string" ? body.leaseToken : "") });
  } catch (error) {
    if (error instanceof MediaWorkerAuthError || error instanceof MediaWorkerQueueError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "任务心跳失败，请稍后重试", code: "MEDIA_JOB_HEARTBEAT_FAILED" }, { status: 500 });
  }
}

