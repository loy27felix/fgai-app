import type { VideoReference, VideoTaskStatus } from './video';

export type VideoGenerationTask = {
  id: string;
  project_id?: string;
  shot_id?: string | null;
  model?: string;
  status: VideoTaskStatus;
  request?: Record<string, unknown> | null;
  output?: { videoUrl?: string; usage?: unknown } | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
};

export type CreateVideoTaskPayload = {
  projectId: string;
  shotId?: string;
  model: string;
  prompt: string;
  references: VideoReference[];
  duration: number;
  ratio: string;
  resolution: string;
  watermark: boolean;
  generateAudio: boolean;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function apiJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) throw new Error(data?.error || `视频任务请求失败 (${response.status})`);
  return data;
}

export async function createVideoTask(payload: CreateVideoTaskPayload, fetcher: Fetcher = fetch) {
  const response = await fetcher('/api/ai/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await apiJson(response);
  return data.task as VideoGenerationTask;
}

export async function getVideoTask(id: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`/api/ai/video/${encodeURIComponent(id)}`);
  const data = await apiJson(response);
  return data.task as VideoGenerationTask;
}

export async function listVideoTasks(projectId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`/api/ai/video?projectId=${encodeURIComponent(projectId)}`);
  const data = await apiJson(response);
  return (data.tasks || []) as VideoGenerationTask[];
}

export function isActiveVideoTask(task: Pick<VideoGenerationTask, 'status'>) {
  return task.status === 'queued' || task.status === 'running';
}
