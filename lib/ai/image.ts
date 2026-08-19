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

async function parseGptResult(data: any, fetcher: Fetcher): Promise<ImageGenerationResult> {
  const item = data?.data?.[0];
  if (item?.b64_json) {
    return { bytes: Buffer.from(item.b64_json, 'base64'), mimeType: item.mime_type || 'image/png' };
  }
  if (item?.url) {
    const response = await fetcher(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`读取生成图片失败 (${response.status})`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png',
      sourceUrl: item.url,
    };
  }
  throw new Error('Wetoken 图片返回为空');
}

function parseGeminiResult(data: any): ImageGenerationResult {
  const parts = data?.candidates?.flatMap((candidate: any) => candidate?.content?.parts || []) || [];
  const image = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
  const inline = image?.inlineData || image?.inline_data;
  if (!inline?.data) throw new Error('Wetoken Gemini 图片返回为空');
  return { bytes: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType || inline.mime_type || 'image/png' };
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
    form.append('response_format', 'b64_json');
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
        model: input.model, prompt: input.prompt, n: 1, size: input.size, response_format: 'b64_json',
      }),
      signal: timeoutSignal(IMAGE_PROVIDER_TIMEOUT_MS),
    });
  }

  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw providerError(response.status, response.statusText, data);
  const parsed = spec.provider === 'gemini' ? parseGeminiResult(data) : await parseGptResult(data, fetcher);
  return { ...parsed, usage: data?.usage };
}
