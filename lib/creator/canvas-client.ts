import type { CreatorCanvas, CreatorCanvasGraph } from '@/lib/creator/types';
import { requestJson } from './image-client';

export type CreatorCanvasListResponse = { canvases: CreatorCanvas[] };
export type CreatorCanvasResponse = { canvas: CreatorCanvas };

export function listCreatorCanvases() {
  return requestJson<CreatorCanvasListResponse>('/api/creator/canvases?kind=image', { method: 'GET' });
}

export function createCreatorCanvas(payload: { title?: string; graph?: CreatorCanvasGraph }) {
  return requestJson<CreatorCanvasResponse>('/api/creator/canvases', {
    method: 'POST',
    body: JSON.stringify({ kind: 'image', ...payload }),
  });
}

export function updateCreatorCanvas(id: string, payload: { title?: string; graph?: CreatorCanvasGraph }) {
  return requestJson<CreatorCanvasResponse>(`/api/creator/canvases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCreatorCanvas(id: string) {
  return requestJson<{ ok: boolean; id: string }>(`/api/creator/canvases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
