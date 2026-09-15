import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { initWorkerUpload, WorkerStorageError, workerLeaseTokenFromRequest } from "@/lib/local/worker-storage";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const body = await request.json().catch(() => ({}));
    const result = await initWorkerUpload(worker, params.id, workerLeaseTokenFromRequest(request), { expectedBytes: body.expectedBytes, mimeType: body.mimeType, fileName: body.fileName, sha256: body.sha256 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const typed = error as { message?: string; code?: string; status?: number };
    return NextResponse.json({ error: typed.message || "上传初始化失败", code: typed.code || "UPLOAD_INIT_FAILED" }, { status: typed.status || 500 });
  }
}

