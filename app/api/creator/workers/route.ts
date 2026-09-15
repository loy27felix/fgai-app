import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { query } from "@/lib/local/db";
import { logServerFailure } from "@/lib/observability/server-log";
import { mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  if (!mediaWorkerEnabled()) return NextResponse.json({ workers: [], enabled: false });
  try {
    const result = await query(
      `select id, name, platform, architecture, capabilities, status, last_seen_at, created_at
       from creator_media_workers where user_id = $1 order by created_at desc`,
      [user.id],
    );
    return NextResponse.json({ enabled: true, workers: result.rows });
  } catch (error) {
    logServerFailure("creator_media_workers_list", error, { userId: user.id });
    return errorResponse("Worker 列表加载失败，请稍后重试", "WORKER_LIST_FAILED", 500);
  }
}

