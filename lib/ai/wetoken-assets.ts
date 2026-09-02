import { randomUUID } from 'node:crypto';
import {
  fullLogPayload,
  logServerEvent,
  logServerFailure,
  redactProviderUrl,
  safeProviderHeaders,
} from '../observability/server-log';
import { wetokenProviderDispatcher, type WetokenFetcher } from './wetoken-transport';

export type WetokenAssetType = 'Image' | 'Video' | 'Audio';

export type WetokenAssetReference = {
  type: 'image' | 'video' | 'audio';
  url: string;
  role: string;
};

export type WetokenCreatedAsset = {
  id: string;
  model: string;
};

export type WetokenPreparedAssetReferences<T extends WetokenAssetReference> = {
  references: T[];
  createdAssets: WetokenCreatedAsset[];
};

type Fetcher = WetokenFetcher;

export type WetokenProviderLogContext = {
  traceId?: string;
  taskId?: string;
};

type AssetRequestDependencies = WetokenProviderLogContext & {
  fetcher?: Fetcher;
};

const ASSET_REQUEST_TIMEOUT_MS = 60_000;
const ASSET_READY_TIMEOUT_MS = 120_000;
const ASSET_POLL_INTERVAL_MS = 1_000;

export class WetokenAssetError extends Error {
  readonly status: number;
  readonly providerCode: string | null;
  readonly retryable: boolean;

  constructor(message: string, status: number, providerCode?: string | null) {
    super(`Wetoken asset request failed (${status}): ${message}`);
    this.name = 'WetokenAssetError';
    this.status = status;
    this.providerCode = providerCode || null;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assetOrigin() {
  return (process.env.WETOKEN_ASSET_BASE_URL || 'https://asset.wetoken.ai').replace(/\/$/, '');
}

function requireKey() {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error('缺少 WETOKEN_API_KEY 环境变量');
  return key;
}

function providerError(value: unknown) {
  const root = asRecord(value);
  const nested = asRecord(root.error);
  const message = typeof root.error === 'string'
    ? root.error
    : typeof nested.message === 'string'
      ? nested.message
      : typeof root.message === 'string' ? root.message : 'asset request failed';
  const rawCode = nested.code ?? root.code;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : null;
  return {
    message: message
      .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
      .replace(/([?&](?:token|key|signature|sig)=)[^&\s]+/gi, '$1***')
      .slice(0, 500),
    code,
  };
}

function assetTypeFor(reference: WetokenAssetReference): WetokenAssetType {
  if (reference.type === 'image') return 'Image';
  if (reference.type === 'video') return 'Video';
  return 'Audio';
}

function extensionFor(reference: WetokenAssetReference) {
  if (reference.type === 'image') return 'jpg';
  if (reference.type === 'video') return 'mp4';
  return 'mp3';
}

function assetName(reference: WetokenAssetReference, index: number) {
  try {
    const url = new URL(reference.url);
    // Signed local media URLs keep the original storage path in the query string.
    // 本地签名媒体 URL 的原始文件路径位于 query，必须优先使用它保留真实扩展名。
    const sourcePath = url.searchParams.get('path') || decodeURIComponent(url.pathname);
    const raw = sourcePath.split('/').pop() || '';
    const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    if (safe && /\.[a-z0-9]+$/i.test(safe)) return safe;
  } catch {
    // Fall through to a stable extension-bearing name for provider assets.
    // 无法解析扩展名时使用带稳定扩展名的素材名称。
  }
  return `reference-${index + 1}.${extensionFor(reference)}`;
}

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function isPrivateHostname(hostname: string) {
  const host = normalizedHostname(hostname);
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (isPrivateIpv4(host)) return true;
  if (!host.includes(':')) return !host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
  const dottedMappedIpv4 = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedMappedIpv4) return isPrivateIpv4(dottedMappedIpv4);
  const hexMappedIpv4 = host.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMappedIpv4) return false;
  // URL normalizes IPv4-mapped IPv6 literals to hexadecimal groups.
  // URL 会把 IPv4-mapped IPv6 规范化为十六进制分组，需还原后检查私网范围。
  const high = Number.parseInt(hexMappedIpv4[1], 16);
  const low = Number.parseInt(hexMappedIpv4[2], 16);
  return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

export function isProviderReachableAssetSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

function isAssetUrl(value: string) {
  return /^asset:\/\/asset-[a-z0-9_-]+$/i.test(value);
}

export function isWetokenAssetUrl(value: string) {
  return isAssetUrl(value);
}

async function assetRequest(
  path: '/v3/open/CreateAsset' | '/v3/open/GetAsset' | '/v3/open/DeleteAsset',
  body: Record<string, unknown>,
  fetcher: Fetcher,
  context: WetokenProviderLogContext = {},
) {
  const exchangeId = randomUUID();
  const requestUrl = `${assetOrigin()}${path}`;
  const baseLogFields = {
    traceId: context.traceId,
    taskId: context.taskId,
    provider: 'wetoken',
    feature: 'wetoken_asset',
    operation: path.split('/').pop(),
    exchangeId,
  };
  const request = {
    method: 'POST',
    url: redactProviderUrl(requestUrl),
    headers: { 'content-type': 'application/json', authorization: '[redacted]' },
    body: fullLogPayload(body),
  };
  logServerEvent('wetoken_asset_exchange', {
    ...baseLogFields,
    stage: 'request_sent',
    request,
  });

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetcher(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requireKey()}`,
      },
      body: JSON.stringify(body),
      dispatcher: wetokenProviderDispatcher,
      signal: AbortSignal.timeout(ASSET_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logServerFailure('wetoken_asset_exchange', error, {
      ...baseLogFields,
      stage: 'transport_failed',
      durationMs: Date.now() - startedAt,
      request,
    });
    throw error;
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    logServerFailure('wetoken_asset_exchange', error, {
      ...baseLogFields,
      stage: 'response_body_read_failed',
      durationMs: Date.now() - startedAt,
      responseStatus: response.status,
      responseHeaders: safeProviderHeaders(response.headers),
      request,
    });
    throw error;
  }

  let data: unknown = {};
  let responseBodyEncoding: 'json' | 'text' = 'json';
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBodyEncoding = 'text';
  }
  logServerEvent('wetoken_asset_exchange', {
    ...baseLogFields,
    stage: 'response_received',
    durationMs: Date.now() - startedAt,
    responseStatus: response.status,
    responseStatusText: response.statusText,
    responseHeaders: safeProviderHeaders(response.headers),
    responseBodyEncoding,
    responseBody: fullLogPayload(data),
    ...(responseBodyEncoding === 'text' ? { responseBodyText: fullLogPayload(responseText) } : {}),
  }, response.ok ? 'info' : 'warn');

  if (!response.ok) {
    const error = providerError(data);
    throw new WetokenAssetError(error.message, response.status, error.code);
  }
  return data;
}

async function createAsset(
  model: string,
  reference: WetokenAssetReference,
  index: number,
  fetcher: Fetcher,
  context: WetokenProviderLogContext,
) {
  if (!isProviderReachableAssetSourceUrl(reference.url)) {
    throw new WetokenAssetError('素材 URL 必须是公网 HTTPS 地址', 400, 'invalid_asset_url');
  }

  const data = await assetRequest('/v3/open/CreateAsset', {
    // Asset and generation requests must use the exact same model identifier.
    // 素材创建与生成任务必须使用完全一致的 model，FILTER OFF 不能降级成基础模型。
    model,
    url: reference.url,
    name: assetName(reference, index),
    AssetType: assetTypeFor(reference),
    ...(model.endsWith('-filter-off') ? { Moderation: { Strategy: 'Skip' } } : {}),
  }, fetcher, context);
  const root = asRecord(data);
  const nested = asRecord(root.data);
  const id = typeof root.id === 'string'
    ? root.id
    : typeof root.Id === 'string'
      ? root.Id
      : typeof nested.id === 'string'
        ? nested.id
        : typeof nested.Id === 'string' ? nested.Id : null;
  if (!id || !/^asset-[a-z0-9_-]+$/i.test(id)) {
    throw new WetokenAssetError('素材库响应缺少有效资产 ID', 502, 'asset_id_missing');
  }
  return { id, model } satisfies WetokenCreatedAsset;
}

async function assetStatus(asset: WetokenCreatedAsset, fetcher: Fetcher, context: WetokenProviderLogContext) {
  const data = await assetRequest('/v3/open/GetAsset', {
    model: asset.model,
    Id: asset.id,
  }, fetcher, context);
  const root = asRecord(data);
  const nested = asRecord(root.data);
  const rawStatus = root.Status ?? root.status ?? nested.Status ?? nested.status;
  if (typeof rawStatus !== 'string' || !rawStatus.trim()) {
    throw new WetokenAssetError('素材查询响应缺少 Status', 502, 'asset_status_missing');
  }
  const status = rawStatus.trim().toLowerCase();
  if (status === 'failed') {
    const error = providerError(data);
    throw new WetokenAssetError(
      error.message === 'asset request failed' ? '素材处理失败' : error.message,
      422,
      'asset_processing_failed',
    );
  }
  return status;
}

async function waitForAssetsActive(assets: WetokenCreatedAsset[], fetcher: Fetcher, context: WetokenProviderLogContext) {
  const deadline = Date.now() + ASSET_READY_TIMEOUT_MS;
  let pending = assets;
  while (pending.length) {
    const checks = await Promise.allSettled(pending.map(async (asset) => ({
      asset,
      status: await assetStatus(asset, fetcher, context),
    })));
    const failed = checks.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    pending = checks.flatMap((result) => result.status === 'fulfilled' && result.value.status !== 'active'
      ? [result.value.asset]
      : []);
    if (!pending.length) return;
    if (Date.now() >= deadline) {
      throw new WetokenAssetError('等待素材变为 Active 超时', 504, 'asset_ready_timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_INTERVAL_MS));
  }
}

async function deleteAsset(asset: WetokenCreatedAsset, fetcher: Fetcher, context: WetokenProviderLogContext) {
  await assetRequest('/v3/open/DeleteAsset', {
    model: asset.model,
    Id: asset.id,
  }, fetcher, context);
}

export async function cleanupWetokenAssets(
  assets: WetokenCreatedAsset[],
  dependencies: AssetRequestDependencies = {},
) {
  if (!assets.length) return true;
  const fetcher = dependencies.fetcher ?? fetch;
  const results = await Promise.allSettled(assets.map((asset) => deleteAsset(asset, fetcher, dependencies)));
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ asset: assets[index], error: result.reason }]
    : []);
  if (failures.length) {
    // Cleanup is best-effort and must never hide the original provider failure.
    // 清理失败不能覆盖原始错误，但必须留下不含凭据的可审计记录。
    console.error('[wetoken asset cleanup failed]', failures.map(({ asset, error }) => ({
      id: asset.id,
      model: asset.model,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    })));
  }
  return failures.length === 0;
}

/**
 * Convert every Seedance reference into an Active provider asset before generation.
 * 将每个 Seedance 参考素材登记并等待为 Active，避免生成接口消费未就绪资产。
 */
export async function prepareWetokenAssetReferences<T extends WetokenAssetReference>(
  model: string,
  references: T[],
  dependencies: AssetRequestDependencies = {},
): Promise<WetokenPreparedAssetReferences<T>> {
  const fetcher = dependencies.fetcher ?? fetch;
  const prepared: T[] = [];
  const createdAssets: WetokenCreatedAsset[] = [];
  const assetsToCheck: WetokenCreatedAsset[] = [];
  try {
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      if (isAssetUrl(reference.url)) {
        assetsToCheck.push({ id: reference.url.slice('asset://'.length), model });
        prepared.push(reference);
        continue;
      }
      const asset = await createAsset(model, reference, index, fetcher, dependencies);
      createdAssets.push(asset);
      assetsToCheck.push(asset);
      prepared.push({ ...reference, url: `asset://${asset.id}` } as T);
    }
    await waitForAssetsActive(assetsToCheck, fetcher, dependencies);
    return { references: prepared, createdAssets };
  } catch (error) {
    await cleanupWetokenAssets(createdAssets, dependencies);
    throw error;
  }
}
