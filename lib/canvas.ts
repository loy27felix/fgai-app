export type CanvasKind = 'ref' | 'prompt' | 'gen';
export type CanvasNode = {
  id: string;
  kind: CanvasKind;
  x: number;
  y: number;
  url?: string | null;
  text?: string;
  result?: string | null;
  busy?: boolean;
};
export type CanvasEdge = { from: string; to: string };
export type CanvasGraph = { nodes: CanvasNode[]; edges: CanvasEdge[] };

export function buildInitialCanvasGraph(input: { imageUrl?: string | null; prompt?: string | null }): CanvasGraph {
  const imageUrl = input.imageUrl || '';
  const prompt = input.prompt?.trim() || '';
  if (!imageUrl && !prompt) return { nodes: [], edges: [] };
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  if (imageUrl) nodes.push({ id: 'seed-ref', kind: 'ref', x: 70, y: 130, url: imageUrl });
  if (prompt) nodes.push({ id: 'seed-prompt', kind: 'prompt', x: 330, y: 115, text: prompt });
  nodes.push({ id: 'seed-gen', kind: 'gen', x: 600, y: 130, result: null });
  if (imageUrl) edges.push({ from: 'seed-ref', to: 'seed-gen' });
  if (prompt) edges.push({ from: 'seed-prompt', to: 'seed-gen' });
  return { nodes, edges };
}
