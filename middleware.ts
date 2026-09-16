import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/local/middleware";
import { requestTraceId } from "@/lib/observability/server-log-edge";

export async function middleware(request: NextRequest) {
  const traceId = requestTraceId(request);
  return await updateSession(request, traceId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)"],
};
