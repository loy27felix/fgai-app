import type { CreatorVideoSkill, VideoReferenceManifest } from '@/lib/creator/video';
import type { CreatorVideoTask, CreatorVideoTaskView, CreatorWorkspace } from '@/lib/creator/types';
import { requestJson, CreatorImageClientError } from './image-client';

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

export function confirmVideoTask(taskId: string) {
  return requestJson<ConfirmVideoTaskResponse>('/api/creator/videos/' + encodeURIComponent(taskId) + '/confirm', {
    method: 'POST',
  });
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
