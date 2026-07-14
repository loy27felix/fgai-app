export type GenerateImagePayload = {
  projectId: string;
  type?: string;
  model: string;
  size: string;
  prompt: string;
  refImages?: string[];
  refTypes?: string[];
  refUrls?: string[];
  shotId?: string;
  shotField?: 'frame_path' | 'keyframe_path' | 'storyboard_path';
};

export async function generateImage(payload: GenerateImagePayload) {
  const response = await fetch('/api/ai/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) throw new Error(data?.error || `图片生成失败 (${response.status})`);
  return data as { ok: true; path: string; url: string; mimeType: string };
}
