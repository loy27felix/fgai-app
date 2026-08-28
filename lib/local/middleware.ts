import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "fg_session";

export function updateSession(request: NextRequest, traceId?: string) {
  const requestHeaders = new Headers(request.headers);
  if (traceId) requestHeaders.set("x-fg-trace-id", traceId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (traceId) response.headers.set("x-fg-trace-id", traceId);
  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login";
  const isPublic = isAuthPage || path === "/" || path === "/api/version" || path.startsWith("/api/auth") || path.startsWith("/api/local") || path.startsWith("/_next");
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    if (traceId) redirect.headers.set("x-fg-trace-id", traceId);
    return redirect;
  }
  if (hasSession && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    const redirect = NextResponse.redirect(url);
    if (traceId) redirect.headers.set("x-fg-trace-id", traceId);
    return redirect;
  }
  return response;
}
