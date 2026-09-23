import type { Project, ScriptTask } from "./domain";
import { applyDraft, createDraft, splitScriptIntoShots, type DraftGraph, type DraftNode, type DraftOperation } from "./canvas-draft";
import { nextDraftPosition, type CanvasViewport } from "./canvas-interactions";

export function buildProjectStartGraph(project: Project, task: ScriptTask | undefined, episode: number): DraftGraph {
  const topic = project.topicSnapshot;
  const topicNode = topic
    ? createDraft("text", `选题 #${topic.id} / ${topic.title}`, [topic.original, topic.conflict || topic.plot, `形式：${topic.form} · ${topic.style}`, `市场：${topic.markets} · 权利：${topic.sourceRights}`].filter(Boolean).join("\n"), 56, 130)
    : undefined;
  if (topicNode) topicNode.metadata = { projectId: project.id, topicId: topic!.id, episode, role: "topic" };
  const contextText = [project.brief && `立项冲突：${project.brief}`, project.direction && `确认方向：${project.direction}`, project.bible && `故事圣经：${project.bible}`].filter(Boolean).join("\n\n") || "项目方向与故事圣经尚待确认。";
  const contextNode = createDraft("text", "项目依据 / 已确认方向", contextText, topicNode ? 410 : 56, 130);
  contextNode.metadata = { projectId: project.id, topicId: project.topicId, episode, role: "project-context" };
  const nodes: DraftNode[] = [topicNode, contextNode].filter((node): node is DraftNode => !!node);
  const edges: DraftGraph["edges"] = topicNode ? [{ from: topicNode.id, to: contextNode.id }] : [];
  if (task) {
    const text = task.content || task.prompt;
    const taskNode = createDraft("text", task.title + (task.content ? ` / v${task.version} 剧本` : " / 批量编写任务"), text, contextNode.x + 354, contextNode.y);
    taskNode.metadata = { projectId: project.id, topicId: project.topicId, episode, taskId: task.id, version: task.content ? task.version : undefined, role: "script-task" };
    nodes.push(taskNode);
    edges.push({ from: contextNode.id, to: taskNode.id });
  }
  return { nodes, edges };
}

export function buildScriptStoryboardGraph(graph: DraftGraph, input: {
  project: Project; episode: number; taskId: string; version: number; title: string;
  script: string; skillIds?: string[]; viewport?: CanvasViewport;
}) {
  const shots = splitScriptIntoShots(input.script);
  const viewport = input.viewport || { x: 10, y: 0, k: 0.82 };
  let next = structuredClone(graph);
  const scriptPosition = nextDraftPosition(next, viewport, { x: 220, y: 150 });
  const scriptNode = createDraft("text", input.title, input.script, scriptPosition.x, scriptPosition.y, input.skillIds || []);
  scriptNode.metadata = {
    projectId: input.project.id, topicId: input.project.topicId, episode: input.episode,
    taskId: input.taskId, version: input.version, role: "script",
  };
  const operations: DraftOperation[] = [{ type: "add", node: scriptNode }];
  const context = next.nodes.find(node => node.metadata?.projectId === input.project.id && node.metadata.role === "project-context");
  const priorTask = next.nodes.find(node => node.metadata?.taskId === input.taskId && node.metadata.role === "script-task");
  const upstream = context || priorTask;
  if (upstream) operations.push({ type: "connect", from: upstream.id, to: scriptNode.id });
  next = applyDraft(next, operations);

  const shotIds: string[] = [];
  for (const [index, shot] of shots.entries()) {
    const position = nextDraftPosition(next, viewport, { x: 220, y: 150 });
    const node = createDraft("shot", `EP${String(input.episode).padStart(2, "0")} · SH${String(index + 1).padStart(2, "0")} / ${shot.title.replace(/^镜头\s*\d+\s*\/\s*/, "")}`, shot.text, position.x, position.y, input.skillIds || []);
    node.metadata = { projectId: input.project.id, topicId: input.project.topicId, episode: input.episode, taskId: input.taskId, version: input.version, role: "shot" };
    next = applyDraft(next, [{ type: "add", node }, { type: "connect", from: scriptNode.id, to: node.id }]);
    shotIds.push(node.id);
  }
  return { graph: next, scriptNodeId: scriptNode.id, shotNodeIds: shotIds };
}
