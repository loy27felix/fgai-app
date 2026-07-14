export type VideoModelSpec = {
  id: string;
  label: string;
  filterOff: boolean;
  speed: 'standard' | 'fast' | 'mini';
  resolutions: string[];
};

export const VIDEO_MODELS: VideoModelSpec[] = [
  { id: 'doubao-seedance-2-0', label: 'Seedance 2.0', filterOff: false, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'] },
  { id: 'doubao-seedance-2-0-filter-off', label: 'Seedance 2.0 · FILTER OFF', filterOff: true, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'] },
  { id: 'doubao-seedance-2-0-fast', label: 'Seedance 2.0 Fast', filterOff: false, speed: 'fast', resolutions: ['480p', '720p'] },
  { id: 'doubao-seedance-2-0-fast-filter-off', label: 'Seedance 2.0 Fast · FILTER OFF', filterOff: true, speed: 'fast', resolutions: ['480p', '720p'] },
  { id: 'dreamina-seedance-2-0-mini', label: 'Seedance 2.0 Mini', filterOff: false, speed: 'mini', resolutions: ['480p', '720p'] },
  { id: 'dreamina-seedance-2-0-mini-filter-off', label: 'Seedance 2.0 Mini · FILTER OFF', filterOff: true, speed: 'mini', resolutions: ['480p', '720p'] },
];

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

const RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);

export function getVideoModel(model: string) {
  return VIDEO_MODELS.find((item) => item.id === model);
}

function assertUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('参考素材 URL 无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('参考素材只支持 HTTP(S) URL');
}

export function buildSeedanceRequest(input: SeedanceInput) {
  const spec = getVideoModel(input.model);
  if (!spec) throw new Error(`不支持的视频模型：${input.model}`);
  if (input.duration !== -1 && (input.duration < 4 || input.duration > 15)) {
    throw new Error('视频时长必须为 4 到 15 秒，或使用 -1 自适应');
  }
  if (!RATIOS.has(input.ratio)) throw new Error(`不支持的画幅：${input.ratio}`);
  if (!spec.resolutions.includes(input.resolution)) {
    throw new Error(`${spec.label} 不支持 ${input.resolution}`);
  }

  const images = input.references.filter((item) => item.type === 'image');
  const videos = input.references.filter((item) => item.type === 'video');
  const audios = input.references.filter((item) => item.type === 'audio');
  if (!input.prompt.trim() && input.references.length === 0) throw new Error('提示词和参考素材不能同时为空');
  if (audios.length && !images.length && !videos.length) throw new Error('音频不能单独作为参考，至少同时提供图片或视频');
  if (images.length > 9) throw new Error('参考图片最多 9 张');
  if (videos.length > 3) throw new Error('参考视频最多 3 个');
  if (audios.length > 3) throw new Error('参考音频最多 3 个');
  if (images.filter((item) => item.role === 'first_frame').length > 1) throw new Error('首帧图片最多 1 张');
  if (images.filter((item) => item.role === 'last_frame').length > 1) throw new Error('尾帧图片最多 1 张');

  const content: any[] = [];
  if (input.prompt.trim()) content.push({ type: 'text', text: input.prompt.trim() });
  for (const reference of input.references) {
    assertUrl(reference.url);
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
    generate_audio: input.generateAudio,
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
  if (value === 'pending' || value === 'processing') return 'running';
  return 'running';
}

async function providerJson(response: Response) {
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || response.statusText || 'request failed').slice(0, 300);
    throw new Error(`Wetoken 视频请求失败 (${response.status}): ${message}`);
  }
  return data;
}

export async function createWetokenVideoTask(
  input: SeedanceInput,
  dependencies: { fetcher?: Fetcher } = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher(`${wetokenOrigin()}/api/v3/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(buildSeedanceRequest(input)),
    signal: AbortSignal.timeout(55_000),
  });
  const data = await providerJson(response);
  const externalTaskId = data?.id || data?.task_id;
  if (!externalTaskId) throw new Error('Wetoken 未返回视频任务 ID');
  return { externalTaskId: String(externalTaskId), status: normalizeStatus(data?.status || 'queued'), raw: data };
}

export async function getWetokenVideoTask(
  externalTaskId: string,
  dependencies: { fetcher?: Fetcher } = {},
) {
  const key = requireKey();
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher(
    `${wetokenOrigin()}/api/v3/contents/generations/tasks/${encodeURIComponent(externalTaskId)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const data = await providerJson(response);
  const error = data?.error?.message || (typeof data?.error === 'string' ? data.error : undefined);
  return {
    externalTaskId: String(data?.id || externalTaskId),
    status: normalizeStatus(data?.status),
    videoUrl: data?.content?.video_url || data?.content?.url || undefined,
    error: error ? String(error).slice(0, 500) : undefined,
    usage: data?.usage,
  };
}
