import { getVideoModel } from './video-models';

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
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Some Wetoken video routes do not acknowledge the request until the provider
// has finished rendering. Seedance 2.5 can therefore take an hour or more
// before returning an external task ID. This is a server-side wait only: the
// browser receives 202 immediately and keeps polling the local task record.
// The LAN deployment has no serverless cap, so allow a conservative three-hour
// window before declaring a still-running provider request unknown.
export const WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

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
  readonly retryable = true;

  constructor(operation: 'submit' | 'poll', durationMs: number, cause: unknown) {
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
  }
}

const RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);

function isInlineImageDataUrl(value: string) {
  return /^data:image\/(?:jpeg|png|webp);base64,/i.test(value);
}

function assertUrl(value: string, type: VideoReference['type']) {
  // Local deployments keep creator assets on a LAN-only NAS. A remote video
  // provider cannot download a 192.168.* URL, but it can receive small image
  // references inline. Video and audio still require provider-reachable URLs.
  if (type === 'image' && isInlineImageDataUrl(value)) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('参考素材 URL 无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('参考素材只支持 HTTP(S) URL');
}

export function buildSeedanceRequest(input: SeedanceInput) {
  const spec = getVideoModel(input.model);
  if (!spec) throw new Error(`不支持的视频模型：${input.model}`);
  if ((input.duration === -1 && !spec.supportsAdaptiveDuration) || (input.duration !== -1 && (input.duration < spec.minDuration || input.duration > spec.maxDuration))) {
    throw new Error(`视频时长必须为 ${spec.minDuration} 到 ${spec.maxDuration} 秒${spec.supportsAdaptiveDuration ? '，或使用 -1 自适应' : ''}`);
  }
  if (!RATIOS.has(input.ratio)) throw new Error(`不支持的画幅：${input.ratio}`);
  if (!spec.resolutions.includes(input.resolution)) {
    throw new Error(`${spec.label} 不支持 ${input.resolution}`);
  }

  const images = input.references.filter((item) => item.type === 'image');
  const videos = input.references.filter((item) => item.type === 'video');
  const audios = input.references.filter((item) => item.type === 'audio');
  const unsupportedReference = input.references.find((item) => !spec.referenceTypes.includes(item.type));
  if (unsupportedReference) throw new Error(`${spec.label} 不支持参考${unsupportedReference.type === 'video' ? '视频' : unsupportedReference.type === 'audio' ? '音频' : '图片'}`);
  if (!input.prompt.trim() && input.references.length === 0) throw new Error('提示词和参考素材不能同时为空');
  if (audios.length && !images.length && !videos.length && !spec.supportsAudioOnlyReference) {
    throw new Error('音频不能单独作为参考，至少同时提供图片或视频');
  }
  if (images.length > spec.maxImageReferences) throw new Error(`参考图片最多 ${spec.maxImageReferences} 张`);
  if (videos.length > spec.maxVideoReferences) throw new Error(`参考视频最多 ${spec.maxVideoReferences} 个`);
  if (audios.length > spec.maxAudioReferences) throw new Error(`参考音频最多 ${spec.maxAudioReferences} 个`);
  if (images.filter((item) => item.role === 'first_frame').length > 1) throw new Error('首帧图片最多 1 张');
  if (images.filter((item) => item.role === 'last_frame').length > 1) throw new Error('尾帧图片最多 1 张');
  const hasFrameImage = images.some((item) => item.role === 'first_frame' || item.role === 'last_frame');
  const referenceMediaCount = images.filter((item) => item.role === 'reference_image').length + videos.length + audios.length;
  if (hasFrameImage && referenceMediaCount > 0) throw new Error('首帧/尾帧不能与参考图、参考视频或参考音频混用');
  if (hasFrameImage && spec.requiresAdaptiveRatioForFrameMode && input.ratio !== 'adaptive') {
    throw new Error(`${spec.label} 的首帧/首尾帧模式只能使用 adaptive 画幅`);
  }

  const content: any[] = [];
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

  return {
    model: input.model,
    content,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
    watermark: input.watermark,
    ...(spec.supportsAudioGeneration ? { generate_audio: input.generateAudio } : {}),
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
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'expired') return value;
  if (value === 'completed') return 'succeeded';
  if (value === 'cancelled' || value === 'canceled' || value === 'error') return 'failed';
  if (value === 'submitted' || value === 'created') return 'queued';
  if (value === 'pending' || value === 'processing') return 'running';
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
  const candidates = [asRecord(nested.task), nested, asRecord(root.task)];
  return candidates.find((candidate) => hasTaskShape(candidate)) || root;
}
async function providerJson(response: Response) {
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const parsedError = readProviderError(data);
    throw new WetokenVideoError(parsedError.message.slice(0, 500) || response.statusText || 'request failed', response.status, parsedError.code);
  }
  return data;
}

async function providerFetch(
  fetcher: Fetcher,
  input: string,
  init: RequestInit,
  operation: 'submit' | 'poll',
) {
  const startedAt = Date.now();
  try {
    return await fetcher(input, init);
  } catch (error) {
    throw new WetokenVideoTransportError(operation, Date.now() - startedAt, error);
  }
}

export async function createWetokenVideoTask(
  input: SeedanceInput,
  dependencies: { fetcher?: Fetcher } = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await providerFetch(fetcher, `${wetokenOrigin()}/api/v3/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      // Avoid reusing a stale proxy socket for this long-running paid POST.
      // 付费提交可能长时间等待响应，强制新连接可避免复用已被代理关闭的 keep-alive socket。
      Connection: 'close',
    },
    body: JSON.stringify(buildSeedanceRequest(input)),
    signal: AbortSignal.timeout(WETOKEN_VIDEO_SUBMIT_TIMEOUT_MS),
  }, 'submit');
  const data = await providerJson(response);
  const payload = taskPayload(data);
  const externalTaskId = payload.id || payload.task_id;
  if (!externalTaskId) throw new Error('Wetoken video task ID missing');
  return { externalTaskId: String(externalTaskId), status: normalizeStatus(payload.status || data?.status || 'queued'), raw: data };
}

export async function getWetokenVideoTask(
  externalTaskId: string,
  dependencies: { fetcher?: Fetcher } = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await providerFetch(
    fetcher,
    `${wetokenOrigin()}/api/v3/contents/generations/tasks/${encodeURIComponent(externalTaskId)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    },
    'poll',
  );
  const data = await providerJson(response);
  const payload = taskPayload(data);
  const taskContent = asRecord(payload.content);
  const taskError = asRecord(payload.error);
  const taskErrorMessage = typeof taskError.message === 'string'
    ? taskError.message
    : typeof payload.error === 'string' ? payload.error : undefined;
  return {
    externalTaskId: String(payload.id || payload.task_id || externalTaskId),
    status: normalizeStatus(payload.status),
    error: taskErrorMessage ? String(taskErrorMessage).slice(0, 500) : undefined,
    videoUrl: typeof taskContent.video_url === 'string' ? taskContent.video_url : typeof taskContent.url === 'string' ? taskContent.url : undefined,
    usage: payload.usage,
  };
}
