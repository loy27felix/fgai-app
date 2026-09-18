import type { CreatorImageSkill, ImageReferenceManifest } from '@/lib/creator/image';
import { notifyCreatorUsageUpdated } from '@/lib/creator/usage-events';
import { extractProviderErrorMessage, normalizeProviderErrorMessage } from '@/lib/creator/provider-error-message';
import type {
  CreatorImageAsset,
  CreatorImageTask,
  CreatorImageTaskView,
  CreatorWorkspace,
} from '@/lib/creator/types';

export type CreateImageDraftPayload = {
  canvasId?: string | null;
  nodeId?: string | null;
  source?: 'canvas' | 'standalone';
  prompt: string;
  model: string;
  ratio: string;
  size?: string;
  references: ImageReferenceManifest[];
  skill?: CreatorImageSkill | null;
  idempotencyKey: string;
};

export type CreateImageDraftResponse = {
  task: CreatorImageTask;
  uploadPaths: string[];
  replayed?: boolean;
};

export type FinalizeImageUploadsResponse = {
  task: CreatorImageTask;
};

export type ConfirmImageTaskResponse = {
  task?: CreatorImageTask;
  asset?: CreatorImageAsset | null;
  resultUrl?: string | null;
  duplicate?: boolean;
  ledgerStatus?: 'succeeded' | 'unknown';
  requiresReconciliation?: boolean;
};

export type ListImageTasksResponse = {
  workspace?: CreatorWorkspace;
  tasks: CreatorImageTaskView[];
};

export type DeleteImageTaskResponse = {
  ok: boolean;
  id: string;
};

export class CreatorImageClientError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'CreatorImageClientError';
    this.code = code;
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function serverMessage(payload: unknown) {
  return extractProviderErrorMessage(payload) || '图片请求失败，请稍后重试';
}

function serverCode(payload: unknown) {
  const value = asRecord(payload).code;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const SAFE_RECONCILIATION_MESSAGES: Record<string, string> = {
  GENERATION_STATUS_UNKNOWN: '图片生成请求状态未知，可能已产生费用，系统正在等待对账，请勿重复提交',
  GENERATION_TIMEOUT: '图片生成超时，可能已经产生费用，请查看任务状态',
  RESULT_RECONCILIATION_REQUIRED: '图片结果写入状态未知，请联系管理员对账',
  LEDGER_RECONCILIATION_REQUIRED: '图片已生成，但用量账本待对账，请联系管理员',
  PROVIDER_REFERENCE_MISSING: '图片已生成，但 WeToken 未返回可对账 Reference ID；任务已标记待对账，请勿重复提交',
};

function safeReconciliationMessage(code: string | null) {
  return code ? SAFE_RECONCILIATION_MESSAGES[code] : undefined;
}

/**
 * Fetch a JSON API and expose only the server's client-safe error message.
 * Dependency response bodies are intentionally not copied into the thrown Error.
 */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const subject = url.includes('/videos') ? 'video' : 'image';
    throw new CreatorImageClientError(
      normalizeProviderErrorMessage(error, {
        subject,
        fallback: subject === 'video' ? '视频请求失败，请稍后重试' : '图片请求失败，请稍后重试',
      }),
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const rawMessage = serverMessage(payload);
    const code = serverCode(payload);
    const subject = url.includes('/videos') ? 'video' : 'image';
    const reconciliationMessage = safeReconciliationMessage(code);
    throw new CreatorImageClientError(
      reconciliationMessage
        ? reconciliationMessage
        : normalizeProviderErrorMessage(rawMessage, {
            status: response.status,
            subject,
            fallback: subject === 'video' ? '视频请求失败，请稍后重试' : '图片请求失败，请稍后重试',
          }),
      response.status,
      code,
    );
  }

  return payload as T;
}

export function createImageDraft(payload: CreateImageDraftPayload, signal?: AbortSignal) {
  return requestJson<CreateImageDraftResponse>('/api/creator/images', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export function finalizeImageUploads(taskId: string, referencePaths: string[], signal?: AbortSignal) {
  return requestJson<FinalizeImageUploadsResponse>(`/api/creator/images/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ referencePaths }),
    signal,
  });
}

export async function confirmImageTask(taskId: string, signal?: AbortSignal) {
  const result = await requestJson<ConfirmImageTaskResponse>(
    '/api/creator/images/' + encodeURIComponent(taskId) + '/confirm',
    { method: 'POST', signal },
  );
  notifyCreatorUsageUpdated();
  return result;
}

export function listImageTasks(filters: { taskId?: string; canvasId?: string; nodeId?: string; pending?: boolean } = {}) {
  const searchParams = new URLSearchParams();
  if (filters.taskId) searchParams.set('taskId', filters.taskId);
  if (filters.canvasId) searchParams.set('canvasId', filters.canvasId);
  if (filters.nodeId) searchParams.set('nodeId', filters.nodeId);
  if (filters.pending) searchParams.set('pending', '1');
  const query = searchParams.toString();
  return requestJson<ListImageTasksResponse>(`/api/creator/images${query ? `?${query}` : ''}`, { method: 'GET' });
}

export function deleteImageTask(taskId: string) {
  return requestJson<DeleteImageTaskResponse>(`/api/creator/images/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}
