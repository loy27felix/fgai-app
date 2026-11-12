import { assertSupportTarget, supportRuntimeEnvironment, SupportEnvironmentError } from './environment';
import { supportServices, type SupportServiceId } from './services';
import { isNativeProduct, readProductEndpoint } from './product-native';

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
  componentCoverage?: Record<string, { connected: boolean; commit?: string }>;
};

// Only operator configuration selects destinations; tool/job arguments never supply a URL.
// 仅服务端配置选择目标地址，绝不接受工具或工单提供的 URL。
export function nativeRuntimeVariable(service: SupportServiceId) {
  return `SUPPORT_BOT_${service.replaceAll('-', '_').toUpperCase()}_VERSION_URL`;
}

export async function readNativeRuntime(service: SupportServiceId, userId?: string): Promise<NativeRuntime> {
  const failure = (reason: string, connected = false): NativeRuntime => ({ service, reason, connected });
  if (!Object.hasOwn(supportServices, service)) return failure('native_runtime_service_invalid');
  if (isNativeProduct(service)) {
    try { return parseNativeRuntime(service, await readProductEndpoint(service, 'version', userId)); }
    catch { return failure('native_product_runtime_or_actor_unavailable'); }
  }
  const configured = process.env[nativeRuntimeVariable(service)];
  if (!configured) return failure('native_runtime_url_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const url = assertSupportTarget(configured, 'runtime');
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
    return parseNativeRuntime(service, payload);
  } catch (error) {
    if (error instanceof SupportEnvironmentError) return failure(error.reason);
    return failure(controller.signal.aborted ? 'native_runtime_request_timeout' : 'native_runtime_request_failed');
  } finally { clearTimeout(timer); }
}

function parseNativeRuntime(service: SupportServiceId, payload: unknown): NativeRuntime {
  const failure = (reason: string, connected = false): NativeRuntime => ({ service, reason, connected });
  const value = payload as { code?: number; data?: unknown };
  const data = (value?.code === 0 ? value.data : value) as { service?: string; build?: Record<string, unknown>; components?: Record<string, { service?: string; build?: Record<string, unknown> }> };
  const build = data?.build;
  // Older Canvas exposes Go buildinfo but no service/dirty fields. Read it, never attest it.
  // 旧 Canvas 仅返回 Go buildinfo；允许读取真实版本，但缺少身份/dirty 字段时绝不签认。
  const legacyCanvas = service === 'canvas' && value?.code === 0 && !data?.service
    && typeof build?.goVersion === 'string' && /^go\d+\./.test(build.goVersion);
  // The renamed frontend keeps the existing investigation key; other service identities remain distinct.
  // 前端更名后沿用原调查标识，其他服务身份仍须严格区分。
  const renamedWeb = service === 'yingce-web' && data?.service === 'meilin-web';
  if (data?.service !== service && !legacyCanvas && !renamedWeb) return failure('native_runtime_service_mismatch', true);
  if (!build || typeof build.commit !== 'string' || !/^[a-f0-9]{7,40}$/i.test(build.commit.trim())) {
    return failure('native_runtime_commit_missing', true);
  }
  if (build.environment !== supportRuntimeEnvironment()) return failure('native_runtime_environment_mismatch', true);
  // Project responses into a fixed safe shape; never forward endpoint fields or exception text.
  // 仅投影固定安全字段，不透传接口附带字段或可能携带凭据的异常文本。
  const text = (value: unknown) => typeof value === 'string' && /^[\w.+:/ -]{1,100}$/.test(value) ? value : undefined;
  const components = service === 'opencreator' ? { daemon: 'opencreator', web: 'opencreator-web' }
    : service === 'adcraft' ? { api: 'adcraft', agent: 'adcraft-agent', web: 'adcraft-web' } : {};
  const componentCoverage: Record<string, { connected: boolean; commit?: string }> = {};
  for (const [component, expectedService] of Object.entries(components)) {
    const observed = data.components?.[component];
    const version = observed?.build;
    const commit = typeof version?.commit === 'string' && /^[a-f0-9]{7,40}$/i.test(version.commit) ? version.commit.toLowerCase() : undefined;
    const connected = observed?.service === expectedService && version?.environment === supportRuntimeEnvironment() && !!commit
      && (build.commit.toLowerCase().startsWith(commit) || commit.startsWith(build.commit.toLowerCase()))
      && (supportRuntimeEnvironment() === 'development' || (version?.dirty === false && typeof version?.version === 'string' && /^[A-Za-z0-9_.+-]{1,80}$/.test(version.version) && !/^(dev|development|unknown)$/i.test(version.version)));
    componentCoverage[component] = { connected, commit };
  }
  const componentsVerified = Object.values(componentCoverage).every(component => component.connected);
  return { service, connected: true, identityVerified: !legacyCanvas && componentsVerified, componentCoverage, commit: build.commit.trim().toLowerCase(),
    buildVersion: text(build.version), buildTime: text(build.buildTime),
    environment: build.environment === 'production' || build.environment === 'development' ? build.environment : undefined,
    dirty: typeof build.dirty === 'boolean' ? build.dirty : undefined,
    checkedAt: new Date().toISOString(), reason: componentsVerified ? 'native_runtime_read' : 'native_runtime_component_missing_or_mismatch' };
}
