import { type NextFetchEvent, type NextRequest } from "next/server";
import { updateSession } from "@/lib/local/middleware";
import { queueEdgeRequestEvent, requestTraceId } from "@/lib/observability/server-log-edge";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const traceId = requestTraceId(request);
  // Every business request needs a compact, trace-correlated audit start record.
  // 每个业务请求都需要保留紧凑的、可按 trace 关联的审计起始记录。
  if (!request.nextUrl.pathname.startsWith("/api/observability/")) {
    const requestEvent = queueEdgeRequestEvent(request, traceId);
    if (requestEvent) event.waitUntil(requestEvent);
  }
  return await updateSession(request, traceId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)"],
};
