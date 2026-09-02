const DEFAULT_INTERNAL_MEDIA_URL = "http://127.0.0.1:3000/api/local/storage/content";

function parseUrl(value: string, base?: URL) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isSameMediaEndpoint(candidate: URL, configured: URL) {
  return candidate.hostname === configured.hostname
    && candidate.port === configured.port
    && candidate.pathname === configured.pathname;
}

export function resolveInternalMediaUrl(candidate: string) {
  const internalBase = parseUrl(process.env.LOCAL_MEDIA_INTERNAL_URL || DEFAULT_INTERNAL_MEDIA_URL);
  if (!internalBase) return candidate;

  // Server-side proxies use the container-local listener for local media.
  // 服务端代理读取本地媒体时走容器内监听，避免依赖浏览器信任的 LAN 证书。
  const publicBase = process.env.LOCAL_MEDIA_URL ? parseUrl(process.env.LOCAL_MEDIA_URL) : null;
  const candidateUrl = parseUrl(candidate, publicBase || internalBase);
  if (!candidateUrl || !isSameMediaEndpoint(candidateUrl, publicBase || internalBase)) return candidate;

  internalBase.search = candidateUrl.search;
  internalBase.hash = candidateUrl.hash;
  return internalBase.toString();
}
