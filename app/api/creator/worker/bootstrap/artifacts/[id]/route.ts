import { NextResponse } from "next/server";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { resolveWorkerArtifact, WorkerBootstrapError } from "@/lib/creator/media-worker-bootstrap";
import { isNasUnavailableError, localFileSize, localStorage } from "@/lib/local/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkerBootstrapError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (isNasUnavailableError(error)) return NextResponse.json({ error: "NAS 媒体存储当前不可用，请稍后重试", code: "NAS_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ error: "Worker 安装包读取失败，请稍后重试", code: "WORKER_ARTIFACT_FAILED" }, { status: 500 });
}
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform")?.trim() || "";
  const code = request.headers.get("x-fg-worker-pairing-code")?.trim() || "";
  try {
    const artifact = await resolveWorkerArtifact(code, platform, params.id);
    const size = await localFileSize(artifact.bucket, artifact.path);
    if (size !== artifact.bytes) return NextResponse.json({ error: "Worker 安装包校验信息与 NAS 文件不一致", code: "WORKER_ARTIFACT_SIZE_MISMATCH" }, { status: 503 });
    const signed = await localStorage(artifact.bucket).createSignedUrl(artifact.path, 10 * 60);
    const signedUrl = signed.data?.signedUrl;
    if (!signedUrl) return NextResponse.json({ error: "Worker 安装包暂时不可下载", code: "WORKER_ARTIFACT_SIGN_FAILED" }, { status: 503 });
    return NextResponse.redirect(new URL(signedUrl, request.url), {
      status: 307,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
