import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/local/middleware";
import { logServerEvent, requestTraceId } from "@/lib/observability/server-log-edge";

export async function middleware(request: NextRequest) {
  const traceId = requestTraceId(request);
  logServerEvent("http_request_received", {
    traceId,
    method: request.method,
    path: request.nextUrl.pathname,
    userAgent: request.headers.get("user-agent") || undefined,
    cfRay: request.headers.get("cf-ray") || undefined,
  });
  return await updateSession(request, traceId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)"],
};
