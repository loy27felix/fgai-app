import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, markWorkerHeartbeat, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const body = await request.json().catch(() => ({}));
    const capabilities = await markWorkerHeartbeat(worker, body.capabilities);
    return NextResponse.json({ ok: true, workerId: worker.workerId, capabilities, serverTime: new Date().toISOString() });
  } catch (error) {
    if (error instanceof MediaWorkerAuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Worker 心跳失败，请稍后重试", code: "WORKER_HEARTBEAT_FAILED" }, { status: 500 });
  }
}

