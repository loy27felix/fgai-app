import { NextResponse } from "next/server";
import { consumePairingCode, MediaWorkerAuthError, mediaWorkerEnabled } from "@/lib/creator/media-worker-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "本地 Worker 功能尚未启用", code: "MEDIA_WORKER_DISABLED" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  try {
    const result = await consumePairingCode(
      typeof body.code === "string" ? body.code.trim() : "",
      body.capabilities,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        platform: typeof body.platform === "string" ? body.platform : undefined,
        architecture: typeof body.architecture === "string" ? body.architecture : undefined,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MediaWorkerAuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Worker 注册失败，请稍后重试", code: "WORKER_REGISTER_FAILED" }, { status: 500 });
  }
}

