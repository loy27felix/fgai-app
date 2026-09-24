/**
 * Validate browser mutations against the public origin when the app sits behind
 * a TLS-terminating reverse proxy. Next's request URL can reflect the internal
 * HTTP hop, while the proxy forwards the original host and scheme separately.
 */
export function hasSameOriginLabRequest(request: Pick<Request, "url" | "headers">): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let origin: URL;
  let requestUrl: URL;
  try {
    origin = new URL(originHeader);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",", 1)[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const protocol = forwardedProto || requestUrl.protocol.slice(0, -1).toLowerCase();
  if (!host || (protocol !== "http" && protocol !== "https")) return false;

  try {
    return origin.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
