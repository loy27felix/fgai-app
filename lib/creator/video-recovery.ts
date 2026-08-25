export type VideoRecoveryFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type KnownWetokenTask = {
  externalTaskId: string;
  status: string;
  videoUrl?: string;
  error?: string;
  usage?: unknown;
};

type ReconciledTask = {
  id: string;
  externalTaskId: string;
  status: 'succeeded';
  output: Record<string, unknown>;
  error: null;
  completedAt: string;
};

export class KnownVideoTaskRecoveryError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_EXTERNAL_TASK_ID' | 'PROVIDER_TASK_NOT_SUCCEEDED' | 'PROVIDER_VIDEO_URL_MISSING' | 'TASK_UPDATE_FAILED',
  ) {
    super(message);
    this.name = 'KnownVideoTaskRecoveryError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeExternalTaskId(value: string) {
  const normalized = value.trim();
  if (!/^cgt-[A-Za-z0-9-]+$/.test(normalized)) {
    throw new KnownVideoTaskRecoveryError('Wetoken 外部任务号无效', 'INVALID_EXTERNAL_TASK_ID');
  }
  return normalized;
}

/**
 * Reconcile a local task that lost its provider task ID while the process was
 * offline. The caller owns database writes and durable media storage; this
 * helper keeps the critical order explicit: verify provider media, archive it,
 * then mark the local task succeeded.
 */
export async function reconcileKnownWetokenVideoTask(input: {
  task: { id: string; output: unknown };
  externalTaskId: string;
  loadProviderTask: (externalTaskId: string) => Promise<KnownWetokenTask>;
  persistOutput: (output: Record<string, unknown>) => Promise<Record<string, unknown>>;
  saveTask: (update: ReconciledTask) => Promise<ReconciledTask | null>;
  now?: () => string;
}) {
  const externalTaskId = normalizeExternalTaskId(input.externalTaskId);
  const provider = await input.loadProviderTask(externalTaskId);
  if (provider.status !== 'succeeded') {
    throw new KnownVideoTaskRecoveryError(
      provider.error || `Wetoken 任务尚未完成（当前状态：${provider.status || 'unknown'}）`,
      'PROVIDER_TASK_NOT_SUCCEEDED',
    );
  }
  if (!provider.videoUrl) {
    throw new KnownVideoTaskRecoveryError(
      'Wetoken 已返回成功，但未包含可播放的视频地址',
      'PROVIDER_VIDEO_URL_MISSING',
    );
  }

  const output = await input.persistOutput({
    ...asRecord(input.task.output),
    provider_task_id: provider.externalTaskId || externalTaskId,
    video_url: provider.videoUrl,
  });
  const saved = await input.saveTask({
    id: input.task.id,
    externalTaskId: provider.externalTaskId || externalTaskId,
    status: 'succeeded',
    output,
    error: null,
    completedAt: (input.now || (() => new Date().toISOString()))(),
  });
  if (!saved) throw new KnownVideoTaskRecoveryError('本地视频任务更新失败', 'TASK_UPDATE_FAILED');
  return { task: saved, provider };
}

function isVideoContentType(contentType: string, url: string) {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalized.startsWith('video/')) return true;
  if (
    normalized === 'application/octet-stream' &&
    /(?:\.mp4|\.mov)(?:[?#]|$)|\/content(?:[/?#]|$)/i.test(url)
  ) {
    return true;
  }
  return (
    !normalized &&
    /(?:\.mp4|\.mov)(?:[?#]|$)|\/content(?:[/?#]|$)/i.test(url)
  );
}

/**
 * Verify that a recovery URL returns media bytes rather than a JSON error,
 * expired signed URL, or an empty response. A tiny range keeps this probe
 * cheap while still exercising the same URL the video element will use.
 */
export async function assertPlayableVideoUrl(
  url: string,
  options: { fetcher?: VideoRecoveryFetcher; signal?: AbortSignal } = {},
) {
  const fetcher = options.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    throw new Error(
      `Video URL is unreachable: ${error instanceof Error ? error.message : 'network request failed'}`,
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Video URL is unavailable (HTTP ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!isVideoContentType(contentType, url)) {
    throw new Error('Recovery endpoint did not return a playable video file');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength === '0') throw new Error('Recovery endpoint returned an empty video file');

  try {
    await response.body?.cancel();
  } catch {
    // Best effort: this is only a short probe request.
  }
  return { contentType: contentType || 'video/mp4', status: response.status };
}
