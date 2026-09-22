import type { CreatorCanvas, CreatorCanvasGraph } from '@/lib/creator/types';
import { requestJson } from './image-client';

export type CreatorCanvasKind = 'image' | 'video';
export type CreatorCanvasListResponse = { canvases: CreatorCanvas[] };
export type CreatorCanvasResponse = { canvas: CreatorCanvas };

export function listCreatorCanvases(kind: CreatorCanvasKind = 'image') {
  return requestJson<CreatorCanvasListResponse>('/api/creator/canvases?kind=' + kind, { method: 'GET' });
}

export function getCreatorCanvas(id: string) {
  return requestJson<CreatorCanvasResponse>('/api/creator/canvases/' + encodeURIComponent(id), { method: 'GET' });
}

export function createCreatorCanvas(payload: { title?: string; graph?: CreatorCanvasGraph }, kind: CreatorCanvasKind = 'image') {
  return requestJson<CreatorCanvasResponse>('/api/creator/canvases', {
    method: 'POST',
    body: JSON.stringify({ kind, ...payload }),
  });
}

export function updateCreatorCanvas(id: string, payload: { title?: string; graph?: CreatorCanvasGraph; expectedVersion: number }) {
  return requestJson<CreatorCanvasResponse>('/api/creator/canvases/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function renameCreatorCanvas(
  id: string,
  title: string,
  expectedVersion?: number | null,
): Promise<CreatorCanvasResponse> {
  const version = expectedVersion ?? (await getCreatorCanvas(id)).canvas.version;
  return updateCreatorCanvas(id, { title, expectedVersion: version });
}

export function deleteCreatorCanvas(id: string) {
  return requestJson<{ ok: boolean; id: string }>('/api/creator/canvases/' + encodeURIComponent(id), {
    method: 'DELETE',
  });
}
