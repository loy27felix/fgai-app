import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "fg_session";

export function updateSession(request: NextRequest, traceId?: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-fg-request-path", request.nextUrl.pathname);
  if (traceId) requestHeaders.set("x-fg-trace-id", traceId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (traceId) response.headers.set("x-fg-trace-id", traceId);
  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login";
  const isPublic = isAuthPage || path === "/" || path === "/api/version"
    || path === "/api/observability/client-errors"
    || path === "/api/observability/client-exchanges"
    || path === "/api/observability/monitor-events"
    || path === "/api/observability/error-events"
    || path === "/api/observability/request-events"
    || path === "/api/observability/report-runner"
    // Feishu callbacks and the worker authenticate independently of browser sessions.
    // 飞书回调与任务处理入口各自鉴权，不能被网页登录重定向拦截。
    || path === "/api/support-bot/events"
    || path === "/api/support-bot/process"
        // The web API checks the FG session itself and returns JSON 401, not login HTML.
        // 网页接口自行校验 FG 会话，未登录返回 JSON 401 而不是登录页 HTML。
        || path === "/api/support-bot/web"
    || path.startsWith("/api/auth") || path.startsWith("/api/local") || path.startsWith("/_next");
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
