import { getImageModel } from '../imageModels';

export type ImageReference = { data: string; mimeType: string };
export type ImageGenerationInput = {
  model: string;
  prompt: string;
  size: string;
  references: ImageReference[];
};
export type ImageGenerationResult = {
  bytes: Uint8Array;
  mimeType: string;
  sourceUrl?: string;
  usage?: unknown;
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

  constructor(message: string) {
    super(message);
    this.name = 'WetokenImageResultError';
    this.publicMessage = message;
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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

export function sizeToAspectRatio(size: string) {
  return ASPECT_RATIOS[size] || '1:1';
}

export function buildGeminiImageBody(input: Pick<ImageGenerationInput, 'prompt' | 'size' | 'references'>) {
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
        imageSize: '1K',
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
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
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

async function parseGeminiResult(data: any, fetcher: Fetcher): Promise<ImageGenerationResult> {
  // Wetoken normally forwards the native Gemini response. Some models/gateway
  // versions instead return the OpenAI-compatible data array, so accept both
  // without issuing another paid generation request.
  if (data?.data?.[0]?.b64_json || data?.data?.[0]?.url) return parseGptResult(data, fetcher);

  const payload = data?.response || data?.result || data;
  const parts = payload?.candidates?.flatMap((candidate: any) => candidate?.content?.parts || []) || [];
  const image = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
  const inline = image?.inlineData || image?.inline_data;
  if (inline?.data) {
    if (typeof inline.data === 'string' && /^https:\/\//i.test(inline.data)) {
      return downloadGeneratedImage(inline.data, inline.mimeType || inline.mime_type, fetcher);
    }
    return decodeInlineImage(inline.data, inline.mimeType || inline.mime_type);
  }

  const file = parts.find((part: any) => part?.fileData?.fileUri || part?.file_data?.file_uri);
  const fileData = file?.fileData || file?.file_data;
  if (fileData?.fileUri || fileData?.file_uri) {
    return downloadGeneratedImage(fileData.fileUri || fileData.file_uri, fileData.mimeType || fileData.mime_type, fetcher);
  }
  throw new WetokenImageResultError('Gemini 返回成功，但响应中未找到可保存的图片数据');
}

async function readProviderPayload(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = normaliseImageMimeType(response.headers.get('content-type'), '');
  if (contentType) return { data: {}, directImage: normaliseGeneratedImage({ bytes, mimeType: contentType }) };
  if (!bytes.byteLength) return { data: {}, directImage: null };
  try {
    return { data: JSON.parse(new TextDecoder().decode(bytes)), directImage: null };
  } catch {
    return { data: {}, directImage: null };
  }
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
  let response: Response;

  if (spec.provider === 'gemini') {
    response = await fetcher(`${base}/content/models/${encodeURIComponent(input.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildGeminiImageBody(input)),
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  } else if (input.references.length) {
    const form = new FormData();
    form.append('model', input.model);
    form.append('prompt', input.prompt);
    form.append('size', input.size);
    form.append('n', '1');
    input.references.forEach((reference, index) => {
      const ext = extensionFor(reference.mimeType);
      form.append('image[]', new Blob([Buffer.from(reference.data, 'base64')], { type: reference.mimeType }), `reference-${index + 1}.${ext}`);
    });
    response = await fetcher(`${base}/images/edits`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  } else {
    response = await fetcher(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: input.model, prompt: input.prompt, n: 1, size: input.size,
      }),
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  }

  const { data, directImage } = await readProviderPayload(response);
  if (!response.ok) throw providerError(response.status, response.statusText, data);
  const parsed = directImage || (spec.provider === 'gemini'
    ? await parseGeminiResult(data, fetcher)
    : await parseGptResult(data, fetcher));
  return { ...parsed, usage: data?.usage };
}
