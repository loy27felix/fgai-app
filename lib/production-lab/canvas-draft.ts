export type DraftKind = "text" | "character" | "scene" | "shot" | "video" | "audio";
export type DraftNode = { id: string; kind: DraftKind; title: string; text: string; x: number; y: number; skillIds: string[]; assetId?: string; assetKind?: "image" | "video" | "audio"; metadata?: { projectId: string; topicId?: number | null; episode?: number; taskId?: string; version?: number; role: "topic" | "project-context" | "script-task" | "script" | "shot" | "asset" | "video" } };
export type DraftGraph = { nodes: DraftNode[]; edges: { from: string; to: string }[] };
export type DraftOperation =
  | { type: "add"; node: DraftNode }
  | { type: "connect"; from: string; to: string }
  | { type: "delete"; ids: string[] }
  | { type: "update"; id: string; title?: string; text?: string };
export const kindLabels: Record<DraftKind, string> = { text: "剧本", character: "角色资产", scene: "场景资产", shot: "镜头", video: "视频任务", audio: "声音" };
function canConnectKinds(from: DraftKind, to: DraftKind) {
  if (from === "text") return ["text", "character", "scene", "shot", "video", "audio"].includes(to);
  if (from === "character" || from === "scene") return ["shot", "video"].includes(to);
  if (from === "shot") return ["video", "audio"].includes(to);
  if (from === "video") return ["video", "audio"].includes(to);
  return to === "video";
}
function createsCycle(edges: DraftGraph["edges"], from: string, to: string) {
  const pending = [to], seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) if (edge.from === current) pending.push(edge.to);
  }
  return false;
}
export function applyDraft(graph: DraftGraph, operations: DraftOperation[]): DraftGraph {
  const next = structuredClone(graph);
  if (operations.length > 100) throw new Error("单次操作过多");
  for (const op of operations) {
    if (op.type === "add") {
      if (next.nodes.some(n => n.id === op.node.id)) throw new Error("重复节点");
      if (!(op.node.kind in kindLabels) || !Number.isFinite(op.node.x) || !Number.isFinite(op.node.y)) throw new Error("节点格式无效");
      next.nodes.push(structuredClone(op.node));
    } else if (op.type === "connect") {
      const source = next.nodes.find(n => n.id === op.from), target = next.nodes.find(n => n.id === op.to);
      if (!source || !target || op.from === op.to || !canConnectKinds(source.kind, target.kind) || createsCycle(next.edges, op.from, op.to)) throw new Error("节点类型不支持此连线，或连线会造成循环");
      if (!next.edges.some(e => e.from === op.from && e.to === op.to)) next.edges.push({ from: op.from, to: op.to });
    } else if (op.type === "delete") {
      const ids = new Set(op.ids);
      if (!ids.size || [...ids].some(id => !next.nodes.some(node => node.id === id))) throw new Error("删除节点不存在");
      next.nodes = next.nodes.filter(node => !ids.has(node.id));
      next.edges = next.edges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to));
    } else {
      const target = next.nodes.find(node => node.id === op.id);
      if (!target || (op.title === undefined && op.text === undefined)) throw new Error("画布修改对象无效");
      if (op.title !== undefined) {
        if (typeof op.title !== "string" || op.title.length > 300) throw new Error("节点标题无效");
        target.title = op.title;
      }
      if (op.text !== undefined) {
        if (typeof op.text !== "string" || op.text.length > 50000) throw new Error("节点内容无效");
        target.text = op.text;
      }
    }
  }
  if (next.nodes.length > 200) throw new Error("交互草图最多 200 个节点");
  return next;
}

export function splitScriptIntoShots(script: string) {
  const lines = script.replace(/\r\n?/g, "\n").split("\n");
  const heading = /^(?:#{1,4}\s*)?(?:镜头|分镜|shot)\s*([0-9A-Za-z一二三四五六七八九十]+)?\s*[｜|：:·-]?\s*(.*)$/i;
  const explicit: { title: string; text: string[] }[] = [];
  let current: { title: string; text: string[] } | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(heading);
    if (match) {
      if (current) explicit.push(current);
      current = { title: [match[1] ? `镜头 ${match[1]}` : "镜头", match[2]].filter(Boolean).join(" / ").slice(0, 120), text: [] };
    } else if (current) current.text.push(line);
  }
  if (current) explicit.push(current);
  const usable = explicit.map((shot, index) => ({ title: shot.title || `镜头 ${String(index + 1).padStart(2, "0")}`, text: shot.text.join("\n") })).filter(shot => shot.text);
  if (usable.length) return usable.slice(0, 80);

  const blocks = script.replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map(value => value.trim()).filter(Boolean);
  const source = blocks.length > 1 ? blocks : script.split(/(?<=[。！？!?])\s*/).map(value => value.trim()).filter(Boolean);
  const shots = source.slice(0, 80).map((value, index) => {
    const first = value.split("\n").find(Boolean) || "";
    const title = first.replace(/^(?:#{1,4}\s*)?(?:第\s*)?[0-9一二三四五六七八九十]+[场幕：:｜|.、-]?\s*/, "").slice(0, 44);
    return { title: `镜头 ${String(index + 1).padStart(2, "0")}${title ? ` / ${title}` : ""}`, text: value.slice(0, 12000) };
  });
  return shots.length ? shots : [{ title: "待拆镜", text: script.slice(0, 12000) }];
}
export function createDraft(kind: DraftKind, title: string, text: string, x: number, y: number, skillIds: string[] = []): DraftNode {
  return { id: crypto.randomUUID(), kind, title, text, x, y, skillIds };
}
export function initialGraph(): DraftGraph {
  const story = createDraft("text", "EP01 / 禁室的钥匙", "示例创作简报\n艾琳进入庄园，调查姐姐的失踪。钥匙出现后，丈夫的解释开始自相矛盾。\n\n待确认：分集大纲、对白、镜头节奏。", 70, 120, ["deepwhite-screenwriting-v1"]);
  const character = createDraft("character", "艾琳 / 角色设定", "身份与服装参考待补充。\n正面、侧面、背面与面部特写应保持同一人物。", 440, 55, ["deepwhite-image-prompt-builder"]);
  const scene = createDraft("scene", "庄园书房 / 夜", "场景参考待补充。\n窗、门、书桌位置需要先确定，供后续镜头复用。", 440, 395, ["deepwhite-image-prompt-builder"]);
  const shot = createDraft("shot", "SH01 / 发现钥匙", "镜头草案：艾琳拉开抽屉，在信件下发现钥匙。\n等待正式剧本与角色、场景参考确认。", 810, 175, ["acting", "seedance-director"]);
  return { nodes: [story, character, scene, shot], edges: [{ from: story.id, to: character.id }, { from: story.id, to: scene.id }, { from: character.id, to: shot.id }, { from: scene.id, to: shot.id }] };
}
