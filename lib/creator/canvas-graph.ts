import type { CreatorCanvasGraph } from './types';

export const MAX_CANVAS_NODES = 650;
export const MAX_CANVAS_EDGES = 1_300;
export const MAX_CANVAS_GRAPH_CHARS = 1_170_000;

export type CanvasGraphLimitResource = 'nodes' | 'edges' | 'graph';

export class CanvasGraphLimitError extends Error {
  readonly code = 'CANVAS_GRAPH_LIMIT_EXCEEDED';

  constructor(
    readonly resource: CanvasGraphLimitResource,
    readonly count: number,
    readonly limit: number,
  ) {
    super(
      resource === 'nodes'
        ? `画布节点数量超过云端限制（当前 ${count} 个，上限 ${limit} 个），请拆分画布后再继续`
        : resource === 'edges'
          ? `画布连线数量超过云端限制（当前 ${count} 条，上限 ${limit} 条），请删除部分连线或拆分画布后再继续`
          : `画布数据量超过云端限制（当前 ${count} 个字符，上限 ${limit} 个字符），请拆分画布或减少节点内容后再继续`,
    );
    this.name = 'CanvasGraphLimitError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeCreatorCanvasGraph(value: unknown): CreatorCanvasGraph {
  const record = asRecord(value);
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (rawNodes.length > MAX_CANVAS_NODES) {
    throw new CanvasGraphLimitError('nodes', rawNodes.length, MAX_CANVAS_NODES);
  }
  const nodes = rawNodes.map(asRecord);
  const validEdges = Array.isArray(record.edges)
    ? record.edges
      .map(asRecord)
      .filter((edge) => typeof edge.from === 'string' && typeof edge.to === 'string')
    : [];
  if (validEdges.length > MAX_CANVAS_EDGES) {
    throw new CanvasGraphLimitError('edges', validEdges.length, MAX_CANVAS_EDGES);
  }
  const edges = validEdges.map((edge) => ({ from: edge.from as string, to: edge.to as string }));
  const viewportRecord = asRecord(record.viewport);
  const x = typeof viewportRecord.x === 'number' && Number.isFinite(viewportRecord.x) ? Math.max(-10000, Math.min(10000, viewportRecord.x)) : 0;
  const y = typeof viewportRecord.y === 'number' && Number.isFinite(viewportRecord.y) ? Math.max(-10000, Math.min(10000, viewportRecord.y)) : 0;
  const zoomValue = typeof viewportRecord.zoom === 'number' ? viewportRecord.zoom : viewportRecord.k;
  const zoom = typeof zoomValue === 'number' && Number.isFinite(zoomValue) ? Math.max(0.35, Math.min(2.4, zoomValue)) : 1;
  const background: 'grid' | 'dots' | 'blank' = record.background === 'dots' || record.background === 'blank' ? record.background : 'grid';
  const appearanceRecord = asRecord(record.appearance);
  const backgroundImagePath = typeof appearanceRecord.backgroundImagePath === 'string' && appearanceRecord.backgroundImagePath.trim() && appearanceRecord.backgroundImagePath.length <= 1024
    ? appearanceRecord.backgroundImagePath.trim()
    : undefined;
  const backgroundImageOpacity = typeof appearanceRecord.backgroundImageOpacity === 'number' && Number.isFinite(appearanceRecord.backgroundImageOpacity)
    ? Math.max(0, Math.min(1, appearanceRecord.backgroundImageOpacity))
    : 0.72;
  const gridOpacity = typeof appearanceRecord.gridOpacity === 'number' && Number.isFinite(appearanceRecord.gridOpacity)
    ? Math.max(0, Math.min(1, appearanceRecord.gridOpacity))
    : 0.4;
  const appearance = { ...(backgroundImagePath ? { backgroundImagePath } : {}), backgroundImageOpacity, gridOpacity };
  const graph = { nodes, edges, viewport: { x, y, zoom, k: zoom }, background, appearance };
  const graphChars = JSON.stringify(graph).length;
  if (graphChars > MAX_CANVAS_GRAPH_CHARS) {
    throw new CanvasGraphLimitError('graph', graphChars, MAX_CANVAS_GRAPH_CHARS);
  }
  return graph;
}
