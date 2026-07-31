import type { CreatorVideoSkill, VideoReferenceManifest } from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView, CreatorWorkspace } from '@/lib/creator/types';
import { requestJson, CreatorImageClientError } from './image-client';
import { notifyCreatorUsageUpdated } from '@/lib/creator/usage-events';

export { CreatorImageClientError };

export type CreateVideoDraftPayload = {
  canvasId?: string | null;
  nodeId?: string | null;
  prompt: string;
  model: string;
  references: VideoReferenceManifest[];
  duration: number;
  ratio: string;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
  skill?: CreatorVideoSkill | null;
  idempotencyKey: string;
};

export type CreateVideoDraftResponse = {
  task: CreatorVideoTask;
  uploadPaths: string[];
  replayed?: boolean;
};

export type FinalizeVideoUploadsResponse = { task: CreatorVideoTask };
export type ConfirmVideoTaskResponse = {
  task?: CreatorVideoTask;
  videoUrl?: string | null;
  duplicate?: boolean;
  ledgerStatus?: 'succeeded' | 'unknown';
  requiresReconciliation?: boolean;
};
export type ListVideoTasksResponse = {
  workspace?: CreatorWorkspace;
  tasks: CreatorVideoTaskView[];
};
export type VideoTaskResponse = { task: CreatorVideoTaskView };
export type DeleteVideoTaskResponse = { ok: boolean; id: string };

export async function uploadVideoReference(taskId: string, path: string, file: File) {
  const body = new FormData();
  body.append('path', path);
  body.append('file', file, file.name);
  let response: Response;
  try {
    response = await fetch('/api/creator/videos/' + encodeURIComponent(taskId), { method: 'POST', body });
  } catch (error) {
    throw new CreatorImageClientError(error instanceof Error ? error.message : '参考素材上传网络请求失败', 0);
  }
  let payload: Record<string, unknown> = {};
  try { payload = await response.json() as Record<string, unknown>; } catch { /* stable error below */ }
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : '参考素材上传失败';
    const code = typeof payload.code === 'string' ? payload.code : null;
    throw new CreatorImageClientError(message, response.status, code);
  }
  return payload;
}
export function createVideoDraft(payload: CreateVideoDraftPayload) {
  return requestJson<CreateVideoDraftResponse>('/api/creator/videos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function finalizeVideoUploads(taskId: string, referencePaths: string[]) {
  return requestJson<FinalizeVideoUploadsResponse>('/api/creator/videos/' + encodeURIComponent(taskId), {
    method: 'PATCH',
    body: JSON.stringify({ referencePaths }),
  });
}

export async function confirmVideoTask(taskId: string) {
  const result = await requestJson<ConfirmVideoTaskResponse>('/api/creator/videos/' + encodeURIComponent(taskId) + '/confirm', {
    method: 'POST',
  });
  notifyCreatorUsageUpdated();
  return result;
}

export function listVideoTasks() {
  return requestJson<ListVideoTasksResponse>('/api/creator/videos', { method: 'GET' });
}

export function getVideoTask(taskId: string) {
  return requestJson<VideoTaskResponse>('/api/creator/videos/' + encodeURIComponent(taskId), { method: 'GET' });
}

export function deleteVideoTask(taskId: string) {
  return requestJson<DeleteVideoTaskResponse>('/api/creator/videos/' + encodeURIComponent(taskId), { method: 'DELETE' });
}
