import { database } from "./store";
import type { DraftGraph, DraftKind } from "./canvas-draft";

const kinds = new Set<DraftKind>(["text", "character", "scene", "shot", "video", "audio"]);

export function validateCanvasGraph(value: unknown): DraftGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("画布数据格式无效");
  const graph = value as Partial<DraftGraph>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 200 || graph.edges.length > 1000) {
    throw new Error("画布节点或连线数量超出上限");
  }
  const ids = new Set<string>();
  const nodes = graph.nodes.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("画布节点格式无效");
    const node = raw as DraftGraph["nodes"][number];
    if (typeof node.id !== "string" || !node.id || node.id.length > 100 || ids.has(node.id)) throw new Error("画布节点编号无效或重复");
    if (!kinds.has(node.kind) || typeof node.title !== "string" || node.title.length > 300 || typeof node.text !== "string" || node.text.length > 50000) throw new Error("画布节点内容无效");
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 10000000 || Math.abs(node.y) > 10000000) throw new Error("画布位置无效");
    if (!Array.isArray(node.skillIds) || node.skillIds.length > 10 || node.skillIds.some((id) => typeof id !== "string" || id.length > 100)) throw new Error("画布技能引用无效");
    if (node.assetId !== undefined && (typeof node.assetId !== "string" || node.assetId.length > 200)) throw new Error("画布素材引用无效");
    ids.add(node.id);
    return { ...node, skillIds: [...new Set(node.skillIds)] };
  });
  const edgeKeys = new Set<string>();
  const edges = graph.edges.map((raw) => {
    if (!raw || typeof raw !== "object" || typeof raw.from !== "string" || typeof raw.to !== "string" || raw.from === raw.to || !ids.has(raw.from) || !ids.has(raw.to)) throw new Error("画布连线引用无效");
    const key = raw.from + "\u0000" + raw.to;
    if (edgeKeys.has(key)) throw new Error("画布连线重复");
    edgeKeys.add(key);
    return { from: raw.from, to: raw.to };
  });
  return { nodes, edges };
}

export async function readProjectCanvas(projectId: string, episode: number) {
  const result = await database().query("SELECT document, version, updated_at FROM production_lab_canvas_graphs WHERE project_id=$1 AND episode=$2", [projectId, episode]);
  return result.rows[0] || null;
}

export async function saveProjectCanvas(input: { projectId: string; episode: number; expectedVersion: number; graph: DraftGraph; actorId: string }) {
  if (input.expectedVersion === 0) {
    const inserted = await database().query(
      "INSERT INTO production_lab_canvas_graphs(project_id,episode,document,version,created_by,updated_by) VALUES($1,$2,$3::jsonb,1,$4,$4) ON CONFLICT DO NOTHING RETURNING version,updated_at",
      [input.projectId, input.episode, JSON.stringify(input.graph), input.actorId],
    );
    if (inserted.rowCount) return inserted.rows[0];
  } else {
    const updated = await database().query(
      "UPDATE production_lab_canvas_graphs SET document=$3::jsonb,version=version+1,updated_by=$4,updated_at=now() WHERE project_id=$1 AND episode=$2 AND version=$5 RETURNING version,updated_at",
      [input.projectId, input.episode, JSON.stringify(input.graph), input.actorId, input.expectedVersion],
    );
    if (updated.rowCount) return updated.rows[0];
  }
  const conflict = await readProjectCanvas(input.projectId, input.episode);
  return { conflict: true as const, version: Number(conflict?.version || 0), updated_at: conflict?.updated_at || null };
}
