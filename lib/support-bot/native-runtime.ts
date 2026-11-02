import { supportServices, type SupportServiceId } from './services';

export type NativeRuntime = {
  service: SupportServiceId;
  commit?: string;
  buildVersion?: string;
  buildTime?: string;
  environment?: 'development' | 'production';
  dirty?: boolean;
  checkedAt?: string;
  connected: boolean;
  identityVerified?: boolean;
  reason: string;
};

// Only operator configuration selects destinations; tool/job arguments never supply a URL.
// 仅服务端配置选择目标地址，绝不接受工具或工单提供的 URL。
export function nativeRuntimeVariable(service: SupportServiceId) {
  return `SUPPORT_BOT_${service.replaceAll('-', '_').toUpperCase()}_VERSION_URL`;
}

export async function readNativeRuntime(service: SupportServiceId): Promise<NativeRuntime> {
  const failure = (reason: string, connected = false): NativeRuntime => ({ service, reason, connected });
  if (!Object.hasOwn(supportServices, service)) return failure('native_runtime_service_invalid');
  const configured = process.env[nativeRuntimeVariable(service)];
  if (!configured) return failure('native_runtime_url_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      return failure('native_runtime_url_invalid');
    }
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return failure('native_runtime_endpoint_unavailable');
    }
    const limit = 16 * 1024;
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body.cancel();
      return failure('native_runtime_response_too_large');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return failure('native_runtime_response_too_large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const data = payload?.code === 0 ? payload.data : payload;
    const build = data?.build;
    // Older Canvas exposes Go buildinfo but no service/dirty fields. Read it, never attest it.
    // 旧 Canvas 仅返回 Go buildinfo；允许读取真实版本，但缺少身份/dirty 字段时绝不签认。
    const legacyCanvas = service === 'canvas' && payload?.code === 0 && !data?.service
      && typeof build?.goVersion === 'string' && /^go\d+\./.test(build.goVersion);
    if (data?.service !== service && !legacyCanvas) return failure('native_runtime_service_mismatch', true);
    if (!build || typeof build.commit !== 'string' || !/^[a-f0-9]{7,40}$/i.test(build.commit.trim())) {
      return failure('native_runtime_commit_missing', true);
    }
    // Project responses into a fixed safe shape; never forward endpoint fields or exception text.
    // 仅投影固定安全字段，不透传接口附带字段或可能携带凭据的异常文本。
    const text = (value: unknown) => typeof value === 'string' && /^[\w.+:/ -]{1,100}$/.test(value) ? value : undefined;
    return { service, connected: true, identityVerified: !legacyCanvas, commit: build.commit.trim().toLowerCase(),
      buildVersion: text(build.version), buildTime: text(build.buildTime),
      environment: build.environment === 'production' || build.environment === 'development' ? build.environment : undefined,
      dirty: typeof build.dirty === 'boolean' ? build.dirty : undefined,
      checkedAt: new Date().toISOString(), reason: 'native_runtime_read' };
  } catch {
    return failure(controller.signal.aborted ? 'native_runtime_request_timeout' : 'native_runtime_request_failed');
  } finally { clearTimeout(timer); }
}
