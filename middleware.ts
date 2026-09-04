import { type NextFetchEvent, type NextRequest } from "next/server";
import { updateSession } from "@/lib/local/middleware";
import { logServerEvent, queueEdgeRequestEvent, requestTraceId } from "@/lib/observability/server-log-edge";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const traceId = requestTraceId(request);
  // Transport events are already the diagnostic payload; recording their own transport would create noisy recursion.
  // 观测传输请求本身已经携带诊断数据，再记录它们会制造噪声并放大日志量。
  if (!request.nextUrl.pathname.startsWith("/api/observability/")) {
    logServerEvent("http_request_received", {
      traceId,
      method: request.method,
      path: request.nextUrl.pathname,
      userAgent: request.headers.get("user-agent") || undefined,
      cfRay: request.headers.get("cf-ray") || undefined,
    });
    const requestEvent = queueEdgeRequestEvent(request, traceId);
    if (requestEvent) event.waitUntil(requestEvent);
  }
  return await updateSession(request, traceId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)"],
};
