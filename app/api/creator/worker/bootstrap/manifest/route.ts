import { NextResponse } from "next/server";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { publicWorkerRelease, WorkerBootstrapError } from "@/lib/creator/media-worker-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkerBootstrapError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "Worker 发布清单读取失败，请稍后重试", code: "WORKER_MANIFEST_FAILED" }, { status: 500 });
}
export async function GET(request: Request) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  const code = request.headers.get("x-fg-worker-pairing-code")?.trim() || "";
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform")?.trim() || "";
  try {
    return NextResponse.json(await publicWorkerRelease(code, platform), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
