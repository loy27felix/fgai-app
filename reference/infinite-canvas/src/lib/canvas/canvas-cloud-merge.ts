import type { CreatorCanvasGraph } from "@/lib/creator/types";

function nodeId(node: Record<string, unknown>) {
  return typeof node.id === "string" ? node.id : "";
}

function edgeKey(edge: { from: string; to: string }) {
  return `${edge.from}\u0000${edge.to}`;
}

/**
 * Preserve additions from both concurrent canvas sessions. The current local
 * edit wins when both sessions modified the same node; explicit deletion stays
 * a separate operation so a save race can never silently erase media.
 */
export function mergeCanvasCloudGraphs(local: CreatorCanvasGraph, remote: CreatorCanvasGraph): CreatorCanvasGraph {
  const nodes = new Map<string, Record<string, unknown>>();
  for (const node of remote.nodes) {
    const id = nodeId(node);
    if (id) nodes.set(id, node);
  }
  for (const node of local.nodes) {
    const id = nodeId(node);
    if (id) nodes.set(id, node);
  }

  const edges = new Map<string, { from: string; to: string }>();
  for (const edge of [...remote.edges, ...local.edges]) edges.set(edgeKey(edge), edge);

  return {
    ...remote,
    ...local,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    viewport: local.viewport || remote.viewport,
    background: local.background || remote.background,
    appearance: { ...(remote.appearance || {}), ...(local.appearance || {}) },
  };
}
