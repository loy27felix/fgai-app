import { timingSafeEqual } from 'node:crypto';

/** Internal endpoints fail closed when their dedicated secret is not configured.
 * 内部端点未配置专用密钥时直接拒绝，避免误把公开请求当作调度请求。
 */
export function hasObservabilitySecret(request: Request) {
  const expected = process.env.FG_OBSERVABILITY_SECRET || process.env.SESSION_SECRET || '';
  const received = request.headers.get('x-fg-observability-secret') || '';
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
