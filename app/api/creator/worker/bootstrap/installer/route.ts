import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { getWorkerRelease, WorkerBootstrapError } from "@/lib/creator/media-worker-bootstrap";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";
import { isNasUnavailableError, localFileSize, localStorage } from "@/lib/local/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkerBootstrapError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (isNasUnavailableError(error)) return NextResponse.json({ error: "NAS 媒体存储当前不可用，请稍后重试", code: "NAS_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ error: "Worker 安装包读取失败，请稍后重试", code: "WORKER_INSTALLER_FAILED" }, { status: 500 });
}
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  const platform = new URL(request.url).searchParams.get("platform")?.trim() || "";
  try {
    const release = await getWorkerRelease(platform);
    const installer = release.artifacts.find((artifact) => artifact.kind === "installer");
    if (!installer) throw new WorkerBootstrapError("当前平台暂未发布一键安装包", "WORKER_RELEASE_UNAVAILABLE", 503);
    const size = await localFileSize(installer.bucket, installer.path);
    if (size !== installer.bytes) throw new WorkerBootstrapError("Worker 安装包校验信息与 NAS 文件不一致", "WORKER_ARTIFACT_SIZE_MISMATCH", 503);
    const signed = await localStorage(installer.bucket).createSignedUrl(installer.path, 10 * 60);
    const signedUrl = signed.data?.signedUrl;
    if (!signedUrl) throw new WorkerBootstrapError("Worker 安装包暂时不可下载", "WORKER_ARTIFACT_SIGN_FAILED", 503);
    return NextResponse.redirect(new URL(signedUrl, request.url), { status: 307, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
