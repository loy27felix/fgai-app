import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { createPairingCode, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";

export const runtime = "nodejs";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  try {
    const pairing = await createPairingCode(user.id);
    return NextResponse.json(pairing);
  } catch {
    return NextResponse.json({ error: "配对码生成失败，请稍后重试", code: "PAIRING_CODE_FAILED" }, { status: 500 });
  }
}

