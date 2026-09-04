import { getImageModel, imageOutputSizeForDimensions, imageOutputSizeOptionsFor } from '../imageModels';
import { wetokenProviderDispatcher, type WetokenFetcher, type WetokenFetcherInit } from './wetoken-transport';
import {
  logCreatorImageEvent,
  logCreatorImageFailure,
  redactCreatorImageLogText,
} from '../creator/image-logging';
import { randomId } from '../utils';
import {
  fullLogPayload,
  logServerEvent,
  logServerFailure,
  redactProviderUrl,
  safeProviderHeaders,
} from '../observability/server-log';

export type ImageReference = { data: string; mimeType: string };
export type ImageGenerationTrace = {
  taskId?: string;
  requestId?: string;
  traceId?: string;
};
export type ImageGenerationInput = {
  model: string;
  prompt: string;
  size: string;
  references: ImageReference[];
  trace?: ImageGenerationTrace;
};
export type ImageGenerationResult = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl?: string;
  usage?: unknown;
  providerDiagnostic?: WetokenImageResultDiagnostic;
};

/**
 * Keep the provider connection below the route's five-minute ceiling. The
 * reserve is needed to upload the received bytes, update the task and settle
 * the ledger before Vercel terminates the function.
 */
export const IMAGE_PROVIDER_TIMEOUT_MS = 270_000;

/**
 * A client-safe provider rejection. The confirm route is allowed to expose
 * this message so creators can distinguish a rejected model request from a
 * persistence or network failure, without ever returning an API key.
 */
export class WetokenImageRequestError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(status: number, message: string) {
    const publicMessage = `图片模型请求失败（HTTP ${status}）：${sanitizeProviderMessage(message)}`;
    super(publicMessage);
    this.name = 'WetokenImageRequestError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

/**
 * A successful provider HTTP response that does not contain a usable image.
 * This is intentionally separate from a rejected request: Wetoken can settle
 * a request before its gateway serialises the generated image into one of the
 * supported response shapes.
 */
export class WetokenImageResultError extends Error {
  readonly publicMessage: string;
  /**
   * Metadata only: this is persisted on the task to make gateway format
   * changes diagnosable. It deliberately contains no response values, image
   * bytes, signed URLs or credentials.
   */
  readonly diagnostic?: WetokenImageResultDiagnostic;

  constructor(message: string, diagnostic?: WetokenImageResultDiagnostic) {
    super(message);
    this.name = 'WetokenImageResultError';
    this.publicMessage = message;
    this.diagnostic = diagnostic;
  }
}

export type WetokenImageResultDiagnostic = {
  providerCallId?: string;
  status: number;
  contentType: string | null;
  responseBytes: number;
  requestId?: string;
  providerRequestId?: string;
  providerResponseId?: string;
  baseResponse?: { statusCode?: string | number; statusMessage?: string };
  candidates?: Array<{ finishReason?: string; finishMessage?: string }>;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  payloadShape: string[];
};

type Fetcher = WetokenFetcher;
type TimeoutSignal = (timeoutMs: number) => AbortSignal;
type ImageGenerationDependencies = {
  fetcher?: Fetcher;
  timeoutSignal?: TimeoutSignal;
};

const ASPECT_RATIOS: Record<string, string> = {
  '1024x1024': '1:1', '1536x864': '16:9', '1344x768': '16:9',
  '864x1536': '9:16', '768x1344': '9:16', '1024x768': '4:3',
  '1152x896': '4:3', '768x1024': '3:4', '896x1152': '3:4',
  '1248x832': '3:2', '1216x832': '3:2', '832x1248': '2:3', '832x1216': '2:3',
};

const GEMINI_ASPECT_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9',
  '1:4', '4:1', '1:8', '8:1',
];

export function sizeToAspectRatio(size: string) {
  if (ASPECT_RATIOS[size]) return ASPECT_RATIOS[size];
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return '1:1';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1';
  const target = width / height;
  return GEMINI_ASPECT_RATIOS.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number);
    const [bestWidth, bestHeight] = best.split(':').map(Number);
    return Math.abs(Math.log(candidateWidth / candidateHeight / target))
      < Math.abs(Math.log(bestWidth / bestHeight / target))
      ? candidate
      : best;
  });
}

export function buildGeminiImageBody(input: Pick<ImageGenerationInput, 'prompt' | 'size' | 'references'> & Pick<Partial<ImageGenerationInput>, 'model'>) {
  const requestedTier = imageOutputSizeForDimensions(input.size);
  const supportedTiers = imageOutputSizeOptionsFor(input.model || '');
  const imageSize = supportedTiers.includes(requestedTier) ? requestedTier : supportedTiers[0];
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: input.prompt },
        ...input.references.map((reference) => ({
          inlineData: { mimeType: reference.mimeType, data: reference.data },
        })),
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: sizeToAspectRatio(input.size),
        imageSize,
        // Wetoken's Gemini image route currently accepts JPEG only. Omitting
        // this makes the three Gemini image models reject otherwise valid
        // generateContent requests, while GPT Image uses a separate API.
        outputMIMEType: 'image/jpeg',
      },
    },
  };
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function sanitizeProviderMessage(value: unknown) {
  return String(value || '请求被模型服务拒绝')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || '请求被模型服务拒绝';
}

function providerError(status: number, statusText: string, data: any) {
  const message = data?.error?.message || data?.message || statusText || 'request failed';
  return new WetokenImageRequestError(status, message);
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normaliseImageMimeType(value: unknown, fallback = 'image/png') {
  const raw = typeof value === 'string' ? value.toLowerCase().split(';', 1)[0].trim() : '';
  const mimeType = raw === 'image/jpg' ? 'image/jpeg' : raw;
  return IMAGE_MIME_TYPES.has(mimeType) ? mimeType : fallback;
}

function imageMimeTypeFromBytes(bytes: Uint8Array) {
  const startsWith = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

function normaliseGeneratedImage(result: ImageGenerationResult): ImageGenerationResult {
  return {
    ...result,
    // The image header is authoritative. Some gateway responses label a PNG
    // as JPEG, which used to make the post-generation validation discard an
    // otherwise valid paid-for result.
    mimeType: imageMimeTypeFromBytes(result.bytes) || normaliseImageMimeType(result.mimeType),
  };
}

function decodeInlineImage(value: unknown, declaredMimeType: unknown): ImageGenerationResult {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WetokenImageResultError('图片模型返回成功，但未包含可保存的图片数据');
  }
  const dataUri = /^data:([^;,]+)(?:;[^,]*)*;base64,([\s\S]+)$/i.exec(value.trim());
  const bytes = Buffer.from((dataUri ? dataUri[2] : value).replace(/\s/g, ''), 'base64');
  if (!bytes.byteLength) {
    throw new WetokenImageResultError('图片模型返回成功，但图片数据为空');
  }
  return normaliseGeneratedImage({
    bytes,
    mimeType: normaliseImageMimeType(dataUri?.[1] || declaredMimeType),
  });
}

async function downloadGeneratedImage(rawUrl: unknown, declaredMimeType: unknown, fetcher: Fetcher): Promise<ImageGenerationResult> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new WetokenImageResultError('图片模型返回成功，但未包含可下载的图片地址');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WetokenImageResultError('图片模型返回了无效的图片地址');
  }
  if (url.protocol !== 'https:') {
    throw new WetokenImageResultError('图片模型返回了不安全的图片地址');
  }
  const response = await fetcher(url, {
    dispatcher: wetokenProviderDispatcher,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new WetokenImageResultError(`读取生成图片失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return normaliseGeneratedImage({
    bytes,
    mimeType: normaliseImageMimeType(response.headers.get('content-type') || declaredMimeType),
    sourceUrl: url.toString(),
  });
}

async function parseGptResult(data: any, fetcher: Fetcher): Promise<ImageGenerationResult> {
  const item = data?.data?.[0];
  if (item?.b64_json) {
    return decodeInlineImage(item.b64_json, item.mime_type);
  }
  if (item?.url) {
    return downloadGeneratedImage(item.url, item.mime_type, fetcher);
  }
  throw new WetokenImageResultError('图片模型返回成功，但未包含可保存的图片数据');
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export function providerRequestIdFromImageDiagnostic(diagnostic: unknown) {
  const value = asRecord(diagnostic);
  if (!value) return undefined;
  return ['providerRequestId', 'providerResponseId', 'requestId']
    .map((key) => value[key])
    .find((item): item is string => typeof item === 'string' && item.length > 0);
}

function diagnosticText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return redactCreatorImageLogText(value).slice(0, 300);
}

function diagnosticNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstValue(record: Record<string, any>, keys: string[]) {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function payloadRoots(data: unknown) {
  const roots: Record<string, any>[] = [];
  const visited = new Set<Record<string, any>>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 3) return;
    // Some Wetoken gateway revisions put the provider JSON into an envelope
    // string (for example `response: "{...}"`).  Treat that as the original
    // provider payload, not as a successful request with no image.
    if (typeof value === 'string') {
      const source = value.trim();
      if (source.length && source.length <= 12 * 1024 * 1024 && (source.startsWith('{') || source.startsWith('['))) {
        try { visit(JSON.parse(source), depth + 1); } catch { /* not JSON */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 12).forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record || visited.has(record)) return;
    visited.add(record);
    roots.push(record);
    ['response', 'result', 'output', 'payload', 'body', 'data', 'events'].forEach((key) => visit(record[key], depth + 1));
  };
  visit(data);
  return roots;
}

function providerResponseMetadata(data: unknown) {
  let providerRequestId: string | undefined;
  let providerResponseId: string | undefined;
  const baseResponse: { statusCode?: string | number; statusMessage?: string } = {};
  const candidateSummary: Array<{ finishReason?: string; finishMessage?: string }> = [];
  const usageSummary: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } = {};

  for (const payload of payloadRoots(data)) {
    const base = asRecord(payload.base_resp) || asRecord(payload.baseResp);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const usage = asRecord(payload.usageMetadata) || asRecord(payload.usage_metadata);
    providerRequestId ||= diagnosticText(firstValue(payload, ['requestId', 'request_id']));
    providerResponseId ||= diagnosticText(firstValue(payload, ['responseId', 'response_id']));
    const statusCode = firstValue(base || {}, ['status_code', 'statusCode', 'code']);
    const statusMessage = diagnosticText(firstValue(base || {}, ['status_msg', 'statusMessage', 'message']));
    if (baseResponse.statusCode === undefined && typeof statusCode === 'number') {
      baseResponse.statusCode = statusCode;
    } else if (baseResponse.statusCode === undefined && typeof statusCode === 'string') {
      baseResponse.statusCode = diagnosticText(statusCode);
    }
    baseResponse.statusMessage ||= statusMessage;
    const remainingCandidates = Math.max(0, 5 - candidateSummary.length);
    candidateSummary.push(...candidates.slice(0, remainingCandidates).map((candidate) => {
      const value = asRecord(candidate) || {};
      const finishReason = diagnosticText(firstValue(value, ['finishReason', 'finish_reason']));
      const finishMessage = diagnosticText(firstValue(value, ['finishMessage', 'finish_message']));
      return finishReason || finishMessage ? {
        ...(finishReason ? { finishReason } : {}),
        ...(finishMessage ? { finishMessage } : {}),
      } : null;
    }).filter((value): value is { finishReason?: string; finishMessage?: string } => value !== null));
    const promptTokenCount = diagnosticNumber(firstValue(usage || {}, ['promptTokenCount', 'prompt_token_count']));
    const candidatesTokenCount = diagnosticNumber(firstValue(usage || {}, ['candidatesTokenCount', 'candidates_token_count']));
    const totalTokenCount = diagnosticNumber(firstValue(usage || {}, ['totalTokenCount', 'total_token_count']));
    if (usageSummary.promptTokenCount === undefined && promptTokenCount !== undefined) {
      usageSummary.promptTokenCount = promptTokenCount;
    }
    if (usageSummary.candidatesTokenCount === undefined && candidatesTokenCount !== undefined) {
      usageSummary.candidatesTokenCount = candidatesTokenCount;
    }
    if (usageSummary.totalTokenCount === undefined && totalTokenCount !== undefined) {
      usageSummary.totalTokenCount = totalTokenCount;
    }
  }
  return {
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(providerResponseId ? { providerResponseId } : {}),
    ...(baseResponse.statusCode !== undefined || baseResponse.statusMessage ? { baseResponse } : {}),
    ...(candidateSummary.length ? { candidates: candidateSummary } : {}),
    ...(Object.keys(usageSummary).length ? { usage: usageSummary } : {}),
  };
}

function partsFromPayload(payload: Record<string, any>) {
  const parts: Record<string, any>[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) value.forEach((item) => {
      const record = asRecord(item);
      if (record) parts.push(record);
    });
    else {
      const record = asRecord(value);
      if (record) parts.push(record);
    }
  };
  for (const candidate of Array.isArray(payload.candidates) ? payload.candidates : []) append(candidate?.content?.parts);
  for (const choice of Array.isArray(payload.choices) ? payload.choices : []) append(choice?.message?.content || choice?.content);
  append(asRecord(payload.content)?.parts || payload.content);
  append(asRecord(payload.output)?.parts || payload.output);
  append(payload.parts);
  append(payload.images);
  append(payload.results);
  append(payload.predictions);
  append(payload.data);
  return parts;
}

function nestedImageParts(payload: Record<string, any>) {
  const parts = partsFromPayload(payload);
  const visited = new Set<Record<string, any>>(parts);
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || parts.length >= 80) return;
    if (Array.isArray(value)) {
      value.slice(0, 16).forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record || visited.has(record)) return;
    visited.add(record);
    const looksLikeImage = [
      'inlineData', 'inline_data', 'fileData', 'file_data',
      'image', 'image_url', 'imageUrl', 'image_data', 'imageData',
      'image_base64', 'imageBase64', 'output_url', 'outputUrl',
      'file_uri', 'fileUri', 'b64_json', 'b64Json', 'base64',
    ].some((key) => key in record);
    if (looksLikeImage) parts.push(record);
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(payload);
  return parts;
}

function imageValueFromText(value: unknown) {
  if (typeof value !== 'string') return null;
  const dataUri = value.match(/data:image\/[a-z0-9.+-]+(?:;[^,\s]*)*;base64,[a-z0-9+/=\s]+/i)?.[0];
  if (dataUri) return { data: dataUri };
  const markdownUrl = value.match(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/i)?.[1];
  if (markdownUrl) return { url: markdownUrl };
  const url = value.trim();
  return /^https:\/\//i.test(url) ? { url } : null;
}

async function parseImageValue(
  value: unknown,
  declaredMimeType: unknown,
  fetcher: Fetcher,
  allowRawBase64 = false,
): Promise<ImageGenerationResult | null> {
  if (typeof value !== 'string' || !value.trim()) return null;
  const textImage = imageValueFromText(value);
  if (textImage?.data) return decodeInlineImage(textImage.data, declaredMimeType);
  if (textImage?.url) return downloadGeneratedImage(textImage.url, declaredMimeType, fetcher);
  if (allowRawBase64) return decodeInlineImage(value, declaredMimeType);
  return null;
}

async function parseImagePart(part: Record<string, any>, fetcher: Fetcher): Promise<ImageGenerationResult | null> {
  const inline = asRecord(part.inlineData) || asRecord(part.inline_data);
  if (inline?.data) {
    const mimeType = inline.mimeType || inline.mime_type || part.mimeType || part.mime_type;
    return typeof inline.data === 'string' && /^https:\/\//i.test(inline.data)
      ? downloadGeneratedImage(inline.data, mimeType, fetcher)
      : decodeInlineImage(inline.data, mimeType);
  }
  const file = asRecord(part.fileData) || asRecord(part.file_data);
  if (file?.fileUri || file?.file_uri || file?.url) {
    return downloadGeneratedImage(file.fileUri || file.file_uri || file.url, file.mimeType || file.mime_type, fetcher);
  }
  const declaredMimeType = part.mime_type || part.mimeType || part.output_mime_type || part.outputMimeType;
  const directImage = await parseImageValue(
    part.image_url || part.imageUrl || part.image_data || part.imageData
      || part.image_base64 || part.imageBase64 || part.output_url || part.outputUrl
      || part.file_uri || part.fileUri,
    declaredMimeType,
    fetcher,
    Boolean(part.image_data || part.imageData || part.image_base64 || part.imageBase64),
  );
  if (directImage) return directImage;
  const imageUrl = asRecord(part.image_url) || asRecord(part.imageUrl);
  if (imageUrl?.url) return downloadGeneratedImage(imageUrl.url, imageUrl.mime_type || imageUrl.mimeType, fetcher);
  const image = asRecord(part.image);
  if (image?.data || image?.b64_json || image?.base64) {
    return decodeInlineImage(image.data || image.b64_json || image.base64, image.mime_type || image.mimeType);
  }
  if (image?.url) return downloadGeneratedImage(image.url, image.mime_type || image.mimeType, fetcher);
  if (part.b64_json || part.b64Json || part.base64) {
    return decodeInlineImage(part.b64_json || part.b64Json || part.base64, part.mime_type || part.mimeType);
  }
  if (part.url) {
    return downloadGeneratedImage(part.url, part.mime_type || part.mimeType, fetcher);
  }
  const typedImageData = typeof part.type === 'string' && /image/i.test(part.type)
    ? await parseImageValue(part.data, declaredMimeType, fetcher, true)
    : null;
  if (typedImageData) return typedImageData;
  const textImage = await parseImageValue(part.text || part.content, declaredMimeType, fetcher);
  if (textImage) return textImage;
  return null;
}

async function parseGeminiResult(
  data: any,
  fetcher: Fetcher,
  diagnostic: WetokenImageResultDiagnostic,
): Promise<ImageGenerationResult> {
  // Wetoken normally forwards the native Gemini response. Gateway revisions
  // have also returned OpenAI-compatible, nested envelope, and SSE payloads.
  // Inspect only well-known image fields and never make another generation
  // request when reconciling one of those successful responses.
  for (const payload of payloadRoots(data)) {
    if (Array.isArray(payload.data) && (payload.data[0]?.b64_json || payload.data[0]?.url)) {
      return parseGptResult(payload, fetcher);
    }
    for (const part of nestedImageParts(payload)) {
      const image = await parseImagePart(part, fetcher);
      if (image) return image;
    }
  }
  throw new WetokenImageResultError('Gemini 返回成功，但响应中未找到可保存的图片数据', diagnostic);
}

function describePayloadShape(value: unknown) {
  const paths = new Set<string>();
  const visit = (current: unknown, path: string, depth: number) => {
    if (depth > 3 || paths.size >= 40) return;
    if (Array.isArray(current)) {
      if (path) paths.add(`${path}[]`);
      current.slice(0, 3).forEach((item) => visit(item, path ? `${path}[]` : '[]', depth + 1));
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    Object.keys(record).slice(0, 20).forEach((key) => {
      const next = path ? `${path}.${key}` : key;
      paths.add(next);
      visit(record[key], next, depth + 1);
    });
  };
  visit(value, '', 0);
  return [...paths].sort().slice(0, 40);
}

function parseResponsePayload(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  try {
    return { data: JSON.parse(text), encoding: 'json' as const, text };
  } catch {
    const events = text
      .split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'))
      .filter((value) => value && value !== '[DONE]')
      .flatMap((value) => {
        try { return [JSON.parse(value)]; } catch { return []; }
      });
    return {
      data: events.length ? { events } : {},
      encoding: events.length ? 'json' as const : 'text' as const,
      text,
    };
  }
}

async function readProviderPayload(response: Response, providerCallId: string) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const rawContentType = response.headers.get('content-type');
  const contentType = normaliseImageMimeType(rawContentType, '');
  const parsed = contentType || !bytes.byteLength
    ? { data: {}, encoding: contentType ? 'binary' as const : 'json' as const, text: '' }
    : parseResponsePayload(bytes);
  const data = parsed.data;
  const requestId = diagnosticText(
    response.headers.get('x-request-id')
      || response.headers.get('request-id')
      || response.headers.get('x-wetoken-request-id'),
  );
  const diagnostic: WetokenImageResultDiagnostic = {
    providerCallId,
    status: response.status,
    contentType: rawContentType,
    responseBytes: bytes.byteLength,
    ...(requestId ? { requestId: requestId.slice(0, 160) } : {}),
    ...providerResponseMetadata(data),
    payloadShape: describePayloadShape(data),
  };
  return {
    data,
    directImage: contentType ? normaliseGeneratedImage({ bytes, mimeType: contentType }) : null,
    diagnostic,
    responseBody: contentType
      ? { contentType: rawContentType, byteLength: bytes.byteLength, body: Buffer.from(bytes).toString('base64') }
      : data,
    responseBodyEncoding: parsed.encoding,
    ...(parsed.encoding === 'text' ? { responseBodyText: parsed.text } : {}),
  };
}

export async function generateWetokenImage(
  input: ImageGenerationInput,
  dependencies: ImageGenerationDependencies = {},
): Promise<ImageGenerationResult> {
  const key = process.env.WETOKEN_API_KEY;
  if (!key) throw new Error('缺少 WETOKEN_API_KEY 环境变量');
  const spec = getImageModel(input.model);
  if (!spec) throw new Error(`不支持的图片模型：${input.model}`);
  if (!input.prompt.trim()) throw new Error('图片提示词为空');
  if (input.references.length > 8) throw new Error('参考图最多 8 张');

  const base = (process.env.WETOKEN_BASE_URL || 'https://wetoken.ai/v1').replace(/\/$/, '');
  const fetcher = dependencies.fetcher ?? fetch;
  const timeoutSignal = dependencies.timeoutSignal ?? AbortSignal.timeout;
  const startedAt = Date.now();
  const providerCallId = randomId();
  const requestContext = {
    provider: 'wetoken',
    providerCallId,
    ...(input.trace?.traceId ? { traceId: input.trace.traceId } : {}),
    ...(input.trace?.taskId ? { taskId: input.trace.taskId } : {}),
    ...(input.trace?.requestId ? { requestId: input.trace.requestId } : {}),
    model: input.model,
    size: input.size,
    promptChars: input.prompt.length,
    referenceCount: input.references.length,
    referenceBytes: input.references.reduce(
      (total, reference) => total + Buffer.byteLength(reference.data, 'base64'),
      0,
    ),
    referenceMimeTypes: [...new Set(input.references.map((reference) => reference.mimeType))],
  };
  const providerOperation = spec.provider === 'gemini'
    ? 'generateContent'
    : input.references.length ? 'images.edits' : 'images.generations';
  logCreatorImageEvent('provider_request_started', {
    ...requestContext,
    operation: providerOperation,
  });
  let requestUrl: string;
  let requestInit: WetokenFetcherInit;
  let requestBody: unknown;
  let bodyEncoding: 'json' | 'multipart/form-data';

  if (spec.provider === 'gemini') {
    requestUrl = `${base}/content/models/${encodeURIComponent(input.model)}:generateContent`;
    requestBody = buildGeminiImageBody(input);
    bodyEncoding = 'json';
    requestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(requestBody),
      dispatcher: wetokenProviderDispatcher,
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    };
  } else if (input.references.length) {
    const files = input.references.map((reference, index) => ({
      field: 'image[]',
      filename: `reference-${index + 1}.${extensionFor(reference.mimeType)}`,
      contentType: reference.mimeType,
      data: reference.data,
    }));
    const form = new FormData();
    form.append('model', input.model);
    form.append('prompt', input.prompt);
    form.append('size', input.size);
    form.append('n', '1');
    files.forEach((file, index) => {
      form.append(file.field, new Blob([Buffer.from(input.references[index].data, 'base64')], { type: file.contentType }), file.filename);
    });
    requestUrl = `${base}/images/edits`;
    requestBody = { model: input.model, prompt: input.prompt, size: input.size, n: 1, files };
    bodyEncoding = 'multipart/form-data';
    requestInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      dispatcher: wetokenProviderDispatcher,
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    };
  } else {
    requestUrl = `${base}/images/generations`;
    requestBody = { model: input.model, prompt: input.prompt, n: 1, size: input.size };
    bodyEncoding = 'json';
    requestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(requestBody),
      dispatcher: wetokenProviderDispatcher,
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    };
  }

  const exchangeRequest = {
    method: requestInit.method || 'POST',
    url: redactProviderUrl(requestUrl),
    headers: safeProviderHeaders(requestInit.headers),
    bodyEncoding,
    body: fullLogPayload(requestBody),
  };
  logServerEvent('wetoken_image_exchange', {
    ...requestContext,
    operation: providerOperation,
    exchangeId: providerCallId,
    stage: 'request_sent',
    request: exchangeRequest,
  });
  let response: Response;

  try {
    response = await fetcher(requestUrl, requestInit);
  } catch (error) {
    logServerFailure('wetoken_image_exchange', error, {
      ...requestContext,
      operation: providerOperation,
      exchangeId: providerCallId,
      stage: 'transport_failed',
      durationMs: Date.now() - startedAt,
      request: exchangeRequest,
    });
    logCreatorImageFailure('provider_request_failed', error, {
      ...requestContext,
      operation: providerOperation,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }

  let data: any;
  let directImage: ImageGenerationResult | null;
  let diagnostic: WetokenImageResultDiagnostic;
  let responseBody: unknown;
  let responseBodyEncoding: 'json' | 'text' | 'binary';
  let responseBodyText: string | undefined;
  try {
    ({ data, directImage, diagnostic, responseBody, responseBodyEncoding, responseBodyText } = await readProviderPayload(response, providerCallId));
  } catch (error) {
    logServerFailure('wetoken_image_exchange', error, {
      ...requestContext,
      operation: providerOperation,
      exchangeId: providerCallId,
      stage: 'response_body_read_failed',
      durationMs: Date.now() - startedAt,
      responseStatus: response.status,
      responseHeaders: safeProviderHeaders(response.headers),
      request: exchangeRequest,
    });
    logCreatorImageFailure('provider_response_read_failed', error, {
      ...requestContext,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }

  logServerEvent('wetoken_image_exchange', {
    ...requestContext,
    operation: providerOperation,
    exchangeId: providerCallId,
    stage: 'response_received',
    durationMs: Date.now() - startedAt,
    responseStatus: response.status,
    responseStatusText: response.statusText,
    responseHeaders: safeProviderHeaders(response.headers),
    responseBodyEncoding,
    responseBody: fullLogPayload(responseBody),
    ...(responseBodyText !== undefined ? { responseBodyText: fullLogPayload(responseBodyText) } : {}),
    request: exchangeRequest,
  }, response.ok ? 'info' : 'warn');

  const responseFields = {
    ...requestContext,
    operation: providerOperation,
    httpStatus: response.status,
    httpStatusText: response.statusText || undefined,
    httpOk: response.ok,
    durationMs: Date.now() - startedAt,
    diagnostic,
  };
  logCreatorImageEvent('provider_response_received', responseFields, response.ok ? 'info' : 'warn');
  if (!response.ok) {
    const error = providerError(response.status, response.statusText, data);
    logCreatorImageFailure('provider_rejected', error, responseFields);
    throw error;
  }

  try {
    const parsed = directImage || (spec.provider === 'gemini'
      ? await parseGeminiResult(data, fetcher, diagnostic)
      : await parseGptResult(data, fetcher));
    logCreatorImageEvent('provider_result_parsed', {
      ...requestContext,
      operation: providerOperation,
      durationMs: Date.now() - startedAt,
      mimeType: parsed.mimeType,
      bytes: parsed.bytes.byteLength,
      sourceUrlPresent: Boolean(parsed.sourceUrl),
    });
    return { ...parsed, usage: data?.usage, providerDiagnostic: diagnostic };
  } catch (error) {
    const normalized = error instanceof WetokenImageResultError && !error.diagnostic
      ? new WetokenImageResultError(error.publicMessage, diagnostic)
      : error;
    const providerDiagnostic = normalized instanceof WetokenImageResultError
      ? normalized.diagnostic || diagnostic
      : diagnostic;
    logCreatorImageFailure('provider_result_parse_failed', normalized, {
      ...requestContext,
      operation: providerOperation,
      durationMs: Date.now() - startedAt,
      diagnostic: providerDiagnostic,
    });
    throw normalized;
  }
}
