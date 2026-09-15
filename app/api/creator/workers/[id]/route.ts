import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { logServerFailure } from "@/lib/observability/server-log";
import { mediaWorkerEnabled, revokeWorker } from "@/lib/creator/media-worker-auth";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const revoked = await revokeWorker(user.id, params.id);
    if (!revoked) return NextResponse.json({ error: "Worker 不存在或已撤销", code: "WORKER_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, id: params.id });
  } catch (error) {
    logServerFailure("creator_media_worker_revoke", error, { userId: user.id, workerId: params.id });
    return NextResponse.json({ error: "撤销 Worker 失败，请稍后重试", code: "WORKER_REVOKE_FAILED" }, { status: 500 });
  }
}

