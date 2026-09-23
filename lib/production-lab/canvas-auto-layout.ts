import { computeWorkflowFlowLayout } from "./workflowFlowLayout";
import type { DraftGraph } from "./canvas-draft";

const NODE_WIDTH = 320;
const NODE_HEIGHT = 420;

/** Lay out the production graph using TapCanvas's deterministic layered-DAG algorithm. */
export function autoLayoutDraftGraph(graph: DraftGraph): DraftGraph {
  const positions = computeWorkflowFlowLayout(
    graph.nodes.map(node => ({
      id: node.id,
      position: { x: node.x, y: node.y },
      size: { width: NODE_WIDTH, height: NODE_HEIGHT },
    })),
    graph.edges.map(edge => ({ source: edge.from, target: edge.to })),
    112,
    42,
  );

  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const position = positions.get(node.id);
      return position ? { ...node, x: position.x + 64, y: position.y + 148 } : node;
    }),
  };
}
