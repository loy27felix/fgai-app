import { NextResponse } from "next/server";
import { authenticateWorker, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { writeWorkerUploadChunk, WorkerStorageError, workerLeaseTokenFromRequest } from "@/lib/local/worker-storage";

export const runtime = "nodejs";

function parseContentRange(value: string | null) {
  const match = value && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new WorkerStorageError("Content-Range 无效", "INVALID_UPLOAD_RANGE", 400);
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const range = parseContentRange(request.headers.get("content-range"));
    const body = Buffer.from(await request.arrayBuffer());
    const result = await writeWorkerUploadChunk(worker, params.id, workerLeaseTokenFromRequest(request), range, body);
    return NextResponse.json(result);
  } catch (error) {
    const typed = error as { message?: string; code?: string; status?: number };
    return NextResponse.json({ error: typed.message || "上传分片失败", code: typed.code || "UPLOAD_CHUNK_FAILED" }, { status: typed.status || 500 });
  }
}

