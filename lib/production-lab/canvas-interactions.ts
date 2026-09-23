import type { DraftGraph } from "./canvas-draft";

export type CanvasViewport = { x: number; y: number; k: number };

export function zoomAtPoint(viewport: CanvasViewport, point: { x: number; y: number }, deltaY: number, min = 0.3, max = 1.5): CanvasViewport {
  const scale = Math.max(min, Math.min(max, viewport.k * Math.exp(-deltaY * 0.0015)));
  const worldX = (point.x - viewport.x) / viewport.k;
  const worldY = (point.y - viewport.y) / viewport.k;
  return { x: point.x - worldX * scale, y: point.y - worldY * scale, k: scale };
}

export function nextDraftPosition(graph: DraftGraph, viewport: CanvasViewport, screen = { x: 180, y: 120 }) {
  const base = { x: (screen.x - viewport.x) / viewport.k, y: (screen.y - viewport.y) / viewport.k };
  const width = 320, height = 420, gapX = 28, gapY = 28;
  for (let index = 0; index < 240; index++) {
    const col = index % 4, row = Math.floor(index / 4);
    const candidate = { x: base.x + col * (width + gapX), y: base.y + row * (height + gapY) };
    const overlaps = graph.nodes.some(node =>
      candidate.x < node.x + width && candidate.x + width > node.x &&
      candidate.y < node.y + height && candidate.y + height > node.y,
    );
    if (!overlaps) return candidate;
  }
  return { x: base.x, y: base.y + graph.nodes.length * (height + gapY) };
}

export function isCanvasEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable=true], .ant-select, .ant-input-number");
}
