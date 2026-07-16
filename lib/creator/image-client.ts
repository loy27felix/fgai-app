import type { CreatorImageSkill, ImageReferenceManifest } from '@/lib/creator/image';
import type {
  CreatorImageAsset,
  CreatorImageTask,
  CreatorImageTaskView,
  CreatorWorkspace,
} from '@/lib/creator/types';

export type CreateImageDraftPayload = {
  canvasId?: string | null;
  nodeId?: string | null;
  prompt: string;
  model: string;
  ratio: string;
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
  const value = asRecord(payload).error;
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : '图片请求失败，请稍后重试';
}

function serverCode(payload: unknown) {
  const value = asRecord(payload).code;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  } catch {
    throw new CreatorImageClientError('网络请求失败，请稍后重试', 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new CreatorImageClientError(
      serverMessage(payload),
      response.status,
      serverCode(payload),
    );
  }

  return payload as T;
}

export function createImageDraft(payload: CreateImageDraftPayload) {
  return requestJson<CreateImageDraftResponse>('/api/creator/images', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function finalizeImageUploads(taskId: string, referencePaths: string[]) {
  return requestJson<FinalizeImageUploadsResponse>(`/api/creator/images/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ referencePaths }),
  });
}

export function confirmImageTask(taskId: string) {
  return requestJson<ConfirmImageTaskResponse>(
    `/api/creator/images/${encodeURIComponent(taskId)}/confirm`,
    { method: 'POST' },
  );
}

export function listImageTasks() {
  return requestJson<ListImageTasksResponse>('/api/creator/images', { method: 'GET' });
}

export function deleteImageTask(taskId: string) {
  return requestJson<DeleteImageTaskResponse>(`/api/creator/images/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}
