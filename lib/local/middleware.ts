import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "fg_session";

export function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login";
  const isPublic = isAuthPage || path === "/" || path.startsWith("/api/auth") || path.startsWith("/api/local") || path.startsWith("/_next");
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasSession && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    return NextResponse.redirect(url);
  }
  return response;
}
