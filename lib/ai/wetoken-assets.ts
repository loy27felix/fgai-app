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
  /** Stable key for one logical paid operation; providers may deduplicate it. */
  idempotencyKey?: string;
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
  readonly uncertain: boolean;

  constructor(message: string, status: number, providerCode?: string | null, options: { uncertain?: boolean } = {}) {
    super(`Wetoken asset request failed (${status}): ${message}`);
    this.name = 'WetokenAssetError';
    this.status = status;
    this.providerCode = providerCode || null;
    this.retryable = status === 408 || status === 429 || status >= 500;
    this.uncertain = options.uncertain === true;
  }
}

/**
 * A transport failure after an asset side effect may have been accepted.
 * 素材副作用可能已经被 provider 接受后才发生传输失败，必须保留资产并等待对账。
 */
export class WetokenAssetTransportError extends Error {
  readonly operation: string;
  readonly exchangeId: string;
  readonly durationMs: number;
  readonly causeName: string;
  readonly causeCode: string | null;
  readonly causeMessage: string;
  readonly retryable = true;
  readonly uncertain = true;

  constructor(operation: string, exchangeId: string, durationMs: number, cause: unknown) {
    const outer = asRecord(cause);
    const nested = asRecord(outer.cause);
    const detail = Object.keys(nested).length ? nested : outer;
    const outerMessage = cause instanceof Error ? cause.message : 'network request failed';
    const detailMessage = typeof detail.message === 'string' ? detail.message : outerMessage;
    const causeName = typeof detail.name === 'string' ? detail.name : cause instanceof Error ? cause.name : typeof cause;
    const causeCode = typeof detail.code === 'string' ? detail.code : null;
    const diagnostic = causeCode ? `${outerMessage} (${causeCode}: ${detailMessage})` : `${outerMessage}: ${detailMessage}`;
    super(`Wetoken asset ${operation} transport failed after ${durationMs}ms: ${diagnostic.slice(0, 300)}`);
    this.name = 'WetokenAssetTransportError';
    this.operation = operation;
    this.exchangeId = exchangeId;
    this.durationMs = durationMs;
    this.causeName = causeName;
    this.causeCode = causeCode;
    this.causeMessage = detailMessage.slice(0, 300);
  }
}

export function isUncertainAssetError(error: unknown) {
  return error instanceof WetokenAssetTransportError || error instanceof WetokenAssetError && error.uncertain;
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
  const data = asRecord(root.data);
  const upperData = asRecord(root.Data);
  const records = [
    asRecord(root.error),
    asRecord(root.Error),
    asRecord(data.error),
    asRecord(data.Error),
    asRecord(upperData.error),
    asRecord(upperData.Error),
    data,
    upperData,
    root,
  ];
  const stringMessages = [root.error, root.Error, data.error, data.Error, upperData.error, upperData.Error];
  const message = stringMessages.find((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    ?? records
      .flatMap((record) => [record.message, record.Message, record.error_description, record.errorDescription, record.reason])
      .find((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    ?? 'asset request failed';
  const rawCode = records
    .flatMap((record) => [record.code, record.Code, record.error_code, record.errorCode])
    .find((item) => typeof item === 'string' || typeof item === 'number');
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
        ...(context.idempotencyKey ? { 'Idempotency-Key': context.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      dispatcher: wetokenProviderDispatcher,
      signal: AbortSignal.timeout(ASSET_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const transportError = new WetokenAssetTransportError(
      path.split('/').pop() || 'request',
      exchangeId,
      Date.now() - startedAt,
      error,
    );
    logServerFailure('wetoken_asset_exchange', error, {
      ...baseLogFields,
      stage: 'transport_failed',
      durationMs: Date.now() - startedAt,
      request,
    });
    throw transportError;
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    const transportError = new WetokenAssetTransportError(
      path.split('/').pop() || 'response_body_read',
      exchangeId,
      Date.now() - startedAt,
      error,
    );
    logServerFailure('wetoken_asset_exchange', error, {
      ...baseLogFields,
      stage: 'response_body_read_failed',
      durationMs: Date.now() - startedAt,
      responseStatus: response.status,
      responseHeaders: safeProviderHeaders(response.headers),
      request,
    });
    throw transportError;
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
    throw new WetokenAssetError(error.message, response.status, error.code, {
      uncertain: path.endsWith('/CreateAsset') && (response.status === 408 || response.status >= 500),
    });
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
    throw new WetokenAssetError('素材库响应缺少有效资产 ID', 502, 'asset_id_missing', { uncertain: true });
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
      error.code || 'asset_processing_failed',
    );
  }
  return status;
}

async function waitForAssetsActive(assets: WetokenCreatedAsset[], fetcher: Fetcher, context: WetokenProviderLogContext) {
  const deadline = Date.now() + ASSET_READY_TIMEOUT_MS;
  let pending = assets;
  let attempt = 0;
  while (pending.length) {
    attempt += 1;
    const checks = await Promise.allSettled(pending.map(async (asset) => ({
      asset,
      status: await assetStatus(asset, fetcher, context),
    })));
    const failed = checks.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      const retryable = failed.reason instanceof WetokenAssetTransportError
        || failed.reason instanceof WetokenAssetError && failed.reason.retryable;
      if (!retryable || Date.now() >= deadline) throw failed.reason;
      logServerEvent('wetoken_asset_exchange', {
        traceId: context.traceId,
        taskId: context.taskId,
        provider: 'wetoken',
        feature: 'wetoken_asset',
        stage: 'asset_poll_retry',
        attempt,
        pendingCount: pending.length,
        operation: 'GetAsset',
      }, 'warn');
      await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_INTERVAL_MS));
      continue;
    }
    pending = checks.flatMap((result) => result.status === 'fulfilled' && result.value.status !== 'active'
      ? [result.value.asset]
      : []);
    if (!pending.length) return;
    if (Date.now() >= deadline) {
      throw new WetokenAssetError('等待素材变为 Active 超时', 504, 'asset_ready_timeout', { uncertain: true });
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
    logServerFailure('wetoken_asset_cleanup_failed', new Error('asset cleanup failed'), {
      failures: failures.map(({ asset, error }) => ({
        id: asset.id,
        model: asset.model,
        message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      })),
    });
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
      const asset = await createAsset(model, reference, index, fetcher, {
        ...dependencies,
        ...(dependencies.idempotencyKey ? { idempotencyKey: `${dependencies.idempotencyKey}:asset:${index}` } : {}),
      });
      createdAssets.push(asset);
      assetsToCheck.push(asset);
      prepared.push({ ...reference, url: `asset://${asset.id}` } as T);
    }
    await waitForAssetsActive(assetsToCheck, fetcher, dependencies);
    return { references: prepared, createdAssets };
  } catch (error) {
    if (!isUncertainAssetError(error)) await cleanupWetokenAssets(createdAssets, dependencies);
    throw error;
  }
}
