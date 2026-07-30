export type CanvasKind = 'ref' | 'prompt' | 'gen' | 'video';
export type CanvasViewport = { x: number; y: number; zoom: number };
export type CanvasBackground = "grid" | "dots" | "blank";

/** Shared node shape used by both creator canvases and the infinite-canvas adapter. */
export type CanvasNode = {
  id: string;
  kind: CanvasKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  url?: string | null;
  text?: string;
  result?: string | null;
  busy?: boolean;
  taskId?: string | null;
  status?: string | null;
  error?: string | null;
  label?: string | null;
  locked?: boolean;
  groupId?: string | null;
  metadata?: Record<string, unknown>;
};
export type CanvasEdge = { from: string; to: string };
export type CanvasGraph = { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport?: CanvasViewport; background?: CanvasBackground };

export function buildInitialCanvasGraph(input: { imageUrl?: string | null; prompt?: string | null; videoPrompt?: string | null }): CanvasGraph {
  const imageUrl = input.imageUrl || '';
  const prompt = input.prompt?.trim() || '';
  const videoPrompt = input.videoPrompt?.trim() || '';
  if (!imageUrl && !prompt && !videoPrompt) return { nodes: [], edges: [] };
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  if (imageUrl) nodes.push({ id: 'seed-ref', kind: 'ref', x: 70, y: 130, url: imageUrl });
  if (prompt) nodes.push({ id: 'seed-prompt', kind: 'prompt', x: 330, y: 115, text: prompt });
  if (imageUrl || prompt) {
    nodes.push({ id: 'seed-gen', kind: 'gen', x: 600, y: 130, result: null });
    if (imageUrl) edges.push({ from: 'seed-ref', to: 'seed-gen' });
    if (prompt) edges.push({ from: 'seed-prompt', to: 'seed-gen' });
  }
  if (videoPrompt) {
    nodes.push({ id: 'seed-video-prompt', kind: 'prompt', x: 330, y: 370, text: videoPrompt });
    nodes.push({ id: 'seed-video', kind: 'video', x: 600, y: 385, result: null });
    if (imageUrl) edges.push({ from: 'seed-ref', to: 'seed-video' });
    edges.push({ from: 'seed-video-prompt', to: 'seed-video' });
  }
  return { nodes, edges };
}
