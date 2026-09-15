import { NextResponse } from "next/server";
import { authenticateWorker, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { completeWorkerUpload, WorkerStorageError, workerLeaseTokenFromRequest } from "@/lib/local/worker-storage";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const body = await request.json().catch(() => ({}));
    const fileName = typeof body.fileName === "string" ? body.fileName : "result.mp4";
    return NextResponse.json({ result: await completeWorkerUpload(worker, params.id, workerLeaseTokenFromRequest(request), fileName) });
  } catch (error) {
    const typed = error as { message?: string; code?: string; status?: number };
    return NextResponse.json({ error: typed.message || "上传完成校验失败", code: typed.code || "UPLOAD_COMPLETE_FAILED" }, { status: typed.status || 500 });
  }
}

