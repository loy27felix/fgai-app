import { randomUUID } from 'node:crypto';
import { getVideoModel } from './video-models';
import { wetokenProviderDispatcher, type WetokenFetcher, type WetokenFetcherInit } from './wetoken-transport';
import {
  cleanupWetokenAssets,
  isProviderReachableAssetSourceUrl,
  isWetokenAssetUrl,
  prepareWetokenAssetReferences,
  WetokenAssetError,
  type WetokenAssetReference,
  type WetokenProviderLogContext,
} from './wetoken-assets';
import {
  fullLogPayload,
  logServerEvent,
  logServerFailure,
  redactProviderUrl,
  safeProviderHeaders,
} from '../observability/server-log';

export { VIDEO_MODELS, getVideoModel } from './video-models';
export type { VideoModelSpec } from './video-models';

export type ImageReferenceRole = 'first_frame' | 'last_frame' | 'reference_image';
export type VideoReference =
  | { type: 'image'; url: string; role: ImageReferenceRole }
  | { type: 'video'; url: string; role: 'reference_video' }
  | { type: 'audio'; url: string; role: 'reference_audio' };

export type SeedanceInput = {
  model: string;
  prompt: string;
  references: VideoReference[];
  duration: number;
  ratio: string;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
};

export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';
type FetcherInit = WetokenFetcherInit;
type Fetcher = WetokenFetcher;
type ProviderOperation = 'submit' | 'poll';
type ProviderFetchContext = WetokenProviderLogContext & { requestBody: unknown };
type ProviderFetchResult = { response: Response; exchangeId: string; startedAt: number };
type ProviderJsonContext = WetokenProviderLogContext & {
  operation: ProviderOperation;
  exchangeId: string;
  startedAt: number;
  requestBody: unknown;
};

// Some Wetoken video routes do not acknowledge the request until the provider
// has finished rendering. Seedance 2.5 can therefore take an hour or more
// before returning an external task ID. This is a server-side wait only: the
// browser receives 202 immediately and keeps polling the local task record.
// The LAN deployment has no serverless cap, so allow a conservative three-hour
// window before declaring a still-running provider request unknown.
export const WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const WETOKEN_VIDEO_POLL_TIMEOUT_MS = 60_000;

export class WetokenVideoError extends Error {
  readonly status: number;
  readonly providerCode: string | null;
  readonly retryable: boolean;

  constructor(message: string, status: number, providerCode?: string | null) {
    super(`Wetoken video request failed (${status}): ${message}`);
    this.name = 'WetokenVideoError';
    this.status = status;
    this.providerCode = providerCode || null;
    this.retryable = status === 408 || status === 429 || (status >= 500 && providerCode !== 'model_not_found');
  }
}

export class WetokenVideoTransportError extends Error {
  readonly operation: 'submit' | 'poll';
  readonly durationMs: number;
  readonly causeName: string;
  readonly causeCode: string | null;
  readonly causeMessage: string;
  readonly exchangeId?: string;
  readonly retryable = true;

  constructor(operation: 'submit' | 'poll', durationMs: number, cause: unknown, exchangeId?: string) {
    const outer = asRecord(cause);
    const nested = asRecord(outer.cause);
    const detail = Object.keys(nested).length ? nested : outer;
    const outerMessage = cause instanceof Error ? cause.message : 'network request failed';
    const detailMessage = typeof detail.message === 'string' ? detail.message : outerMessage;
    const detailName = typeof detail.name === 'string'
      ? detail.name
      : cause instanceof Error ? cause.name : typeof cause;
    const detailCode = typeof detail.code === 'string' ? detail.code : null;
    const diagnostic = detailCode ? `${outerMessage} (${detailCode}: ${detailMessage})` : `${outerMessage}: ${detailMessage}`;
    super(`Wetoken video ${operation} transport failed after ${durationMs}ms: ${diagnostic.slice(0, 300)}`);
    this.name = 'WetokenVideoTransportError';
    this.operation = operation;
    this.durationMs = durationMs;
    this.causeName = detailName;
    this.causeCode = detailCode;
    this.causeMessage = detailMessage.slice(0, 300);
    this.exchangeId = exchangeId;
  }
}

export function isDefinitiveWetokenVideoRejection(error: unknown): error is WetokenVideoError {
  return error instanceof WetokenVideoError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 499;
}

const RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '4:5', '5:4', '9:16', '21:9', '9:21']);

function assertUrl(value: string, _type: VideoReference['type']) {
  if (isWetokenAssetUrl(value)) return;
  if (!isProviderReachableAssetSourceUrl(value)) {
    throw new Error('参考素材只支持公网 HTTPS URL 或 asset:// 素材地址');
  }
}

function isVideoReference(value: unknown): value is VideoReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  if (typeof reference.type !== 'string' || typeof reference.url !== 'string' || typeof reference.role !== 'string') return false;
  if (reference.type === 'image') {
    return reference.role === 'first_frame' || reference.role === 'last_frame' || reference.role === 'reference_image';
  }
  if (reference.type === 'video') return reference.role === 'reference_video';
  if (reference.type === 'audio') return reference.role === 'reference_audio';
  return false;
}

export function assertSeedanceInputTypes(input: SeedanceInput) {
  if (typeof input.model !== 'string') throw new Error('model 必须是 string');
  if (typeof input.prompt !== 'string') throw new Error('prompt 必须是 string');
  if (!Array.isArray(input.references) || !input.references.every(isVideoReference)) {
    throw new Error('references 字段类型无效');
  }
  if (typeof input.duration !== 'number' || !Number.isSafeInteger(input.duration)) throw new Error('duration 必须是 number');
  if (typeof input.ratio !== 'string') throw new Error('ratio 必须是 string');
  if (typeof input.resolution !== 'string') throw new Error('resolution 必须是 string');
  if (typeof input.watermark !== 'boolean') throw new Error('watermark 必须是 boolean');
  if (typeof input.generateAudio !== 'boolean') throw new Error('generateAudio 必须是 boolean');
}

type VideoContent = Array<Record<string, unknown>>;
export type WetokenVideoRequest =
  | { family: 'volcengine'; body: Record<string, unknown> }
  | { family: 'dashscope'; body: Record<string, unknown> }
  | { family: 'minimax-v2'; body: Record<string, unknown> };

function validateWetokenVideoInput(input: SeedanceInput) {
  assertSeedanceInputTypes(input);
  const spec = getVideoModel(input.model);
  if (!spec) throw new Error(`不支持的视频模型：${input.model}`);
  if ((input.duration === -1 && !spec.supportsAdaptiveDuration) || (input.duration !== -1 && (input.duration < spec.minDuration || input.duration > spec.maxDuration))) {
    throw new Error(`视频时长必须为 ${spec.minDuration} 到 ${spec.maxDuration} 秒${spec.supportsAdaptiveDuration ? '，或使用 -1 自适应' : ''}`);
  }
  if (!RATIOS.has(input.ratio)) throw new Error(`不支持的画幅：${input.ratio}`);
  if (!spec.ratios.includes(input.ratio)) throw new Error(`${spec.label} 不支持 ${input.ratio} 画幅`);
  if (!spec.resolutions.includes(input.resolution)) {
    throw new Error(`${spec.label} 不支持 ${input.resolution}`);
  }

  const images = input.references.filter((item) => item.type === 'image');
  const videos = input.references.filter((item) => item.type === 'video');
  const audios = input.references.filter((item) => item.type === 'audio');
  const unsupportedReference = input.references.find((item) => !spec.referenceTypes.includes(item.type));
  if (unsupportedReference) throw new Error(`${spec.label} 不支持参考${unsupportedReference.type === 'video' ? '视频' : unsupportedReference.type === 'audio' ? '音频' : '图片'}`);
  if (input.references.length > spec.maxTotalReferences) throw new Error(`参考素材最多 ${spec.maxTotalReferences} 个`);
  if (!input.prompt.trim() && input.references.length === 0) throw new Error('提示词和参考素材不能同时为空');
  if (spec.requiresPrompt && !input.prompt.trim()) throw new Error(`${spec.label} 需要填写提示词`);
  if (audios.length && !images.length && !videos.length && !spec.supportsAudioOnlyReference) {
    throw new Error('音频不能单独作为参考，至少同时提供图片或视频');
  }
  if (images.length < spec.minImageReferences) throw new Error(`${spec.label} 至少需要 ${spec.minImageReferences} 张参考图片`);
  if (images.length > spec.maxImageReferences) throw new Error(`参考图片最多 ${spec.maxImageReferences} 张`);
  if (videos.length > spec.maxVideoReferences) throw new Error(`参考视频最多 ${spec.maxVideoReferences} 个`);
  if (audios.length > spec.maxAudioReferences) throw new Error(`参考音频最多 ${spec.maxAudioReferences} 个`);
  if (images.filter((item) => item.role === 'first_frame').length > 1) throw new Error('首帧图片最多 1 张');
  if (images.filter((item) => item.role === 'last_frame').length > 1) throw new Error('尾帧图片最多 1 张');
  const unsupportedImageRole = images.find((item) => !spec.imageRoles.includes(item.role));
  if (unsupportedImageRole) throw new Error(`${spec.label} 不支持${unsupportedImageRole.role === 'first_frame' ? '首帧' : unsupportedImageRole.role === 'last_frame' ? '尾帧' : '参考图'}模式`);
  const hasFrameImage = images.some((item) => item.role === 'first_frame' || item.role === 'last_frame');
  const referenceMediaCount = images.filter((item) => item.role === 'reference_image').length + videos.length + audios.length;
  if (hasFrameImage && referenceMediaCount > 0) throw new Error('首帧/尾帧不能与参考图、参考视频或参考音频混用');
  if (hasFrameImage && spec.requiresAdaptiveRatioForFrameMode && input.ratio !== 'adaptive') {
    throw new Error(`${spec.label} 的首帧/首尾帧模式只能使用 adaptive 画幅`);
  }
  if (!input.references.length && spec.requiresFixedRatioWithoutReferences && input.ratio === 'adaptive') {
    throw new Error(`${spec.label} 无参考素材时需要选择固定画幅`);
  }

  const content: VideoContent = [];
  if (input.prompt.trim()) content.push({ type: 'text', text: input.prompt.trim() });
  for (const reference of input.references) {
    assertUrl(reference.url, reference.type);
    if (reference.type === 'image') {
      content.push({ type: 'image_url', image_url: { url: reference.url }, role: reference.role });
    } else if (reference.type === 'video') {
      content.push({ type: 'video_url', video_url: { url: reference.url }, role: reference.role });
    } else {
      content.push({ type: 'audio_url', audio_url: { url: reference.url }, role: reference.role });
    }
  }

  return { spec, content, images };
}

function buildVolcengineRequest(input: SeedanceInput, content: VideoContent, supportsAudioGeneration: boolean) {
  return {
    model: input.model,
    content,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    watermark: input.watermark,
    ...(supportsAudioGeneration ? { generate_audio: input.generateAudio } : {}),
  };
}

export function buildWetokenVideoRequest(input: SeedanceInput): WetokenVideoRequest {
  const { spec, content, images } = validateWetokenVideoInput(input);
  if (spec.transport === 'volcengine') {
    return { family: 'volcengine', body: buildVolcengineRequest(input, content, spec.supportsAudioGeneration) };
  }
  if (spec.transport === 'dashscope') {
    const parameters: Record<string, unknown> = {
      resolution: input.resolution === '1080p' ? '1080P' : '720P',
      duration: input.duration,
      prompt_extend: true,
      watermark: input.watermark,
    };
    if (input.ratio !== 'adaptive') parameters.ratio = input.ratio;
    return {
      family: 'dashscope',
      body: {
        model: input.model,
        input: {
          prompt: input.prompt.trim(),
          ...(images.length ? { media: images.map((reference) => ({ type: reference.role, url: reference.url })) } : {}),
        },
        parameters,
      },
    };
  }
  return {
    family: 'minimax-v2',
    body: {
      model: input.model,
      content,
      resolution: input.resolution === '2K' ? '2K' : '768P',
      duration: input.duration,
      ratio: input.ratio,
    },
  };
}

// Kept as a compatibility API for callers and custom scripts that expect the
// established Volcengine body. New provider families must use the generic
// builder above so their distinct contracts cannot be sent to this endpoint.
export function buildSeedanceRequest(input: SeedanceInput) {
  const request = buildWetokenVideoRequest(input);
  if (request.family !== 'volcengine') {
    throw new Error(`${input.model} 不使用 Seedance 请求协议`);
  }
  return request.body as {
    model: string;
    content: VideoContent;
    duration: number;
    ratio: string;
    resolution: string;
    watermark: boolean;
    generate_audio?: boolean;
  };
}

function wetokenOrigin() {
  const configured = process.env.WETOKEN_BASE_URL || 'https://wetoken.ai/v1';
  return new URL(configured).origin;
}

function requireKey() {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error('缺少 WETOKEN_API_KEY 环境变量');
  return key;
}

function normalizeStatus(value: unknown): VideoTaskStatus {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed' || status === 'expired') return status;
  if (status === 'completed' || status === 'success') return 'succeeded';
  if (status === 'cancelled' || status === 'canceled' || status === 'error' || status === 'fail') return 'failed';
  if (status === 'submitted' || status === 'created') return 'queued';
  if (status === 'pending' || status === 'processing') return 'running';
  return 'running';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readProviderError(value: unknown): { code: string | null; message: string } {
  let current: unknown = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof current === 'string') {
      const text = current.trim();
      if (!text) return { code: null, message: 'request failed' };
      try {
        current = JSON.parse(text);
        continue;
      } catch {
        return { code: null, message: text };
      }
    }
    const record = asRecord(current);
    const nested = asRecord(record.error);
    const code = typeof nested.code === 'string'
      ? nested.code
      : typeof record.code === 'string' ? record.code : null;
    if (typeof nested.message === 'string') return { code, message: nested.message };
    if (typeof record.message === 'string') {
      if (record.message.trim().startsWith('{') || record.message.trim().startsWith('[')) {
        current = record.message;
        continue;
      }
      return { code, message: record.message };
    }
    if (typeof record.error === 'string') {
      current = record.error;
      continue;
    }
    return { code, message: 'request failed' };
  }
  return { code: null, message: 'request failed' };
}

function hasTaskShape(value: Record<string, unknown>) {
  return typeof value.id === 'string'
    || typeof value.task_id === 'string'
    || typeof value.status === 'string'
    || 'content' in value
    || 'error' in value
    || 'usage' in value
    || typeof value.video_url === 'string'
    || typeof value.url === 'string';
}

function taskPayload(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  if (typeof root.id === 'string' || typeof root.task_id === 'string') return root;
  const nested = asRecord(root.data);
  const output = asRecord(root.output);
  const candidates = [asRecord(nested.task), nested, asRecord(root.task), output, asRecord(output.task)];
  return candidates.find((candidate) => hasTaskShape(candidate)) || root;
}
async function providerJson(response: Response, context: ProviderJsonContext) {
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    logServerFailure('wetoken_video_exchange', error, {
      traceId: context.traceId,
      taskId: context.taskId,
      provider: 'wetoken',
      feature: 'wetoken_video',
      operation: context.operation,
      exchangeId: context.exchangeId,
      stage: 'response_body_read_failed',
      durationMs: Date.now() - context.startedAt,
      responseStatus: response.status,
      responseHeaders: safeProviderHeaders(response.headers),
      requestBody: fullLogPayload(context.requestBody),
    });
    throw new WetokenVideoTransportError(context.operation, Date.now() - context.startedAt, error, context.exchangeId);
  }

  let data: unknown = {};
  let responseBodyEncoding: 'json' | 'text' = 'json';
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBodyEncoding = 'text';
  }
  logServerEvent('wetoken_video_exchange', {
    traceId: context.traceId,
    taskId: context.taskId,
    provider: 'wetoken',
    feature: 'wetoken_video',
    operation: context.operation,
    exchangeId: context.exchangeId,
    stage: 'response_received',
    durationMs: Date.now() - context.startedAt,
    responseStatus: response.status,
    responseStatusText: response.statusText,
    responseHeaders: safeProviderHeaders(response.headers),
    responseBodyEncoding,
    responseBody: fullLogPayload(data),
    ...(responseBodyEncoding === 'text' ? { responseBodyText: fullLogPayload(responseText) } : {}),
  }, response.ok ? 'info' : 'warn');

  if (!response.ok) {
    const parsedError = readProviderError(data);
    throw new WetokenVideoError(parsedError.message.slice(0, 500) || response.statusText || 'request failed', response.status, parsedError.code);
  }
  return data;
}

async function providerFetch(
  fetcher: Fetcher,
  input: string,
  init: FetcherInit,
  operation: ProviderOperation,
  context: ProviderFetchContext,
): Promise<ProviderFetchResult> {
  const exchangeId = randomUUID();
  const startedAt = Date.now();
  const request = {
    method: init.method || 'GET',
    url: redactProviderUrl(input),
    headers: safeProviderHeaders(init.headers),
    body: fullLogPayload(context.requestBody),
  };
  logServerEvent('wetoken_video_exchange', {
    traceId: context.traceId,
    taskId: context.taskId,
    provider: 'wetoken',
    feature: 'wetoken_video',
    operation,
    exchangeId,
    stage: 'request_sent',
    request,
  });
  try {
    const response = await fetcher(input, init);
    return { response, exchangeId, startedAt };
  } catch (error) {
    const transportError = new WetokenVideoTransportError(operation, Date.now() - startedAt, error, exchangeId);
    logServerFailure('wetoken_video_exchange', transportError, {
      traceId: context.traceId,
      taskId: context.taskId,
      provider: 'wetoken',
      feature: 'wetoken_video',
      operation,
      exchangeId,
      stage: 'transport_failed',
      durationMs: Date.now() - startedAt,
      request,
      causeName: transportError.causeName,
      causeCode: transportError.causeCode,
      causeMessage: transportError.causeMessage,
    });
    throw transportError;
  }
}

function taskSubmitPath(family: WetokenVideoRequest['family']) {
  if (family === 'dashscope') return '/dashscope/api/v1/services/aigc/video-generation/video-synthesis';
  if (family === 'minimax-v2') return '/v2/video_generation';
  return '/api/v3/contents/generations/tasks';
}

function taskQueryPath(family: WetokenVideoRequest['family'], externalTaskId: string) {
  const taskId = encodeURIComponent(externalTaskId);
  if (family === 'dashscope') return `/dashscope/api/v1/tasks/${taskId}`;
  if (family === 'minimax-v2') return `/v2/query/video_generation/${taskId}`;
  return `/api/v3/contents/generations/tasks/${taskId}`;
}

function transportForModel(model: string): WetokenVideoRequest['family'] {
  const transport = getVideoModel(model)?.transport;
  if (transport === 'dashscope') return 'dashscope';
  if (transport === 'minimax-v2') return 'minimax-v2';
  return 'volcengine';
}

export async function createWetokenVideoTask(
  input: SeedanceInput,
  dependencies: { fetcher?: Fetcher; assetsPrepared?: boolean } & WetokenProviderLogContext = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  // Validate generation capabilities before creating provider-side assets.
  // 先校验生成参数，避免无效请求先在素材库留下资产。
  buildWetokenVideoRequest(input);
  if (dependencies.assetsPrepared && input.references.some((reference) => !isWetokenAssetUrl(reference.url))) {
    throw new WetokenAssetError('预处理后的参考素材必须全部使用 asset:// 地址', 500, 'asset_preparation_incomplete');
  }
  const prepared = dependencies.assetsPrepared
    ? { references: input.references as WetokenAssetReference[], createdAssets: [] }
    : await prepareWetokenAssetReferences(
      input.model,
      input.references as WetokenAssetReference[],
      {
        fetcher,
        traceId: dependencies.traceId,
        taskId: dependencies.taskId,
        idempotencyKey: dependencies.idempotencyKey,
      },
    );
  try {
    const request = buildWetokenVideoRequest({
      ...input,
      references: prepared.references as VideoReference[],
    });
    const requestBody = request.body;
    const providerResponse = await providerFetch(fetcher, `${wetokenOrigin()}${taskSubmitPath(request.family)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(request.family === 'dashscope' ? { 'X-DashScope-Async': 'enable' } : {}),
        ...(dependencies.idempotencyKey ? { 'Idempotency-Key': dependencies.idempotencyKey } : {}),
        // Avoid reusing a stale proxy socket for this long-running paid POST.
        // 付费提交可能长时间等待响应，强制新连接可避免复用已被代理关闭的 keep-alive socket。
        Connection: 'close',
      },
      dispatcher: wetokenProviderDispatcher,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS),
    }, 'submit', {
      traceId: dependencies.traceId,
      taskId: dependencies.taskId,
      requestBody,
    });
    const data = await providerJson(providerResponse.response, {
      traceId: dependencies.traceId,
      taskId: dependencies.taskId,
      operation: 'submit',
      exchangeId: providerResponse.exchangeId,
      startedAt: providerResponse.startedAt,
      requestBody,
    });
    const payload = taskPayload(data);
    const externalTaskId = payload.id || payload.task_id;
    if (!externalTaskId) throw new Error('Wetoken video task ID missing');
    return { externalTaskId: String(externalTaskId), status: normalizeStatus(payload.status || payload.task_status || asRecord(data).status || 'queued'), raw: data };
  } catch (error) {
    // Only definitive 4xx rejection is safe to clean up; 408/5xx may hide an accepted upstream task.
    // 仅确定性 4xx 拒绝可清理素材；408/5xx 可能发生在上游已受理之后，必须保留用于对账。
    if (isDefinitiveWetokenVideoRejection(error)) {
      await cleanupWetokenAssets(prepared.createdAssets, { fetcher, traceId: dependencies.traceId, taskId: dependencies.taskId });
    }
    throw error;
  }
}

export async function getWetokenVideoTask(
  externalTaskId: string,
  dependencies: { fetcher?: Fetcher; model?: string } & WetokenProviderLogContext = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  const family = transportForModel(dependencies.model || '');
  const providerResponse = await providerFetch(
    fetcher,
    `${wetokenOrigin()}${taskQueryPath(family, externalTaskId)}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(family === 'dashscope' ? { 'X-DashScope-Async': 'enable' } : {}),
      },
      dispatcher: wetokenProviderDispatcher,
      signal: AbortSignal.timeout(WETOKEN_VIDEO_POLL_TIMEOUT_MS),
    },
    'poll',
    { traceId: dependencies.traceId, taskId: dependencies.taskId, requestBody: null },
  );
  const data = await providerJson(providerResponse.response, {
    traceId: dependencies.traceId,
    taskId: dependencies.taskId,
    operation: 'poll',
    exchangeId: providerResponse.exchangeId,
    startedAt: providerResponse.startedAt,
    requestBody: null,
  });
  const payload = taskPayload(data);
  const taskContent = asRecord(payload.content);
  const taskError = asRecord(payload.error);
  const taskErrorMessage = typeof taskError.message === 'string'
    ? taskError.message
    : typeof payload.error === 'string' ? payload.error
      : typeof payload.message === 'string' ? payload.message : undefined;
  return {
    externalTaskId: String(payload.id || payload.task_id || externalTaskId),
    status: normalizeStatus(payload.status || payload.task_status || asRecord(data).status),
    error: taskErrorMessage ? String(taskErrorMessage).slice(0, 500) : undefined,
    videoUrl: typeof taskContent.video_url === 'string' ? taskContent.video_url
      : typeof taskContent.url === 'string' ? taskContent.url
        : typeof payload.video_url === 'string' ? payload.video_url
          : typeof payload.url === 'string' ? payload.url : undefined,
    usage: payload.usage,
  };
}
