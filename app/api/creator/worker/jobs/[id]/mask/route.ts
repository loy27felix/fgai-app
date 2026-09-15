import { NextResponse } from "next/server";
import { authenticateWorker, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { openWorkerMask, WorkerStorageError, workerLeaseTokenFromRequest } from "@/lib/local/worker-storage";
import { readLocalRange } from "@/lib/local/storage";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const typed = error as { message?: string; code?: string; status?: number };
  return NextResponse.json({ error: typed.message || "读取任务遮罩失败", code: typed.code || "WORKER_MASK_FAILED" }, { status: typed.status || 500 });
}

function parseRange(value: string | null, size: number) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) throw new WorkerStorageError("Range 范围无效", "INVALID_RANGE", 416);
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  const end = Math.min(size - 1, requestedEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new WorkerStorageError("Range 范围无效", "INVALID_RANGE", 416);
  return { start, end, partial: true };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const worker = await authenticateWorker(request);
    const leaseToken = workerLeaseTokenFromRequest(request);
    const mask = await openWorkerMask(worker, params.id, leaseToken);
    const range = parseRange(request.headers.get("range"), mask.size);
    const body = await readLocalRange(mask.bucket, mask.storagePath, range.start, range.end);
    return new Response(body, {
      status: range.partial ? 206 : 200,
      headers: {
        "content-type": mask.mimeType,
        "content-length": String(body.byteLength),
        "accept-ranges": "bytes",
        ...(range.partial ? { "content-range": `bytes ${range.start}-${range.end}/${mask.size}` } : {}),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) { return errorResponse(error); }
}
