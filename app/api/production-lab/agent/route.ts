import { NextResponse } from "next/server";
import { labActor } from "@/lib/production-lab/access";
import { readLab } from "@/lib/production-lab/store";
import { labTextModels } from "@/lib/production-lab/text-models";
import { readProjectCanvas, validateCanvasGraph } from "@/lib/production-lab/canvas-storage";
import { parseAgentResult, productionAgentSkillContext, productionAgentSystemPrompt, summarizeProductionCanvas, validateAgentMessages } from "@/lib/production-lab/production-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 100000) return NextResponse.json({ error: "对话请求过大" }, { status: 413 });
  let body: { model?: unknown; projectId?: unknown; episode?: unknown; selectedNodeId?: unknown; skillIds?: unknown; messages?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  if (typeof body.model !== "string" || typeof body.projectId !== "string" || !body.projectId || body.projectId.length > 100 || !Number.isInteger(body.episode) || Number(body.episode) < 1 || Number(body.episode) > 200) {
    return NextResponse.json({ error: "请指定已配置模型、制作项目和分集" }, { status: 400 });
  }
  if (body.selectedNodeId !== undefined && (typeof body.selectedNodeId !== "string" || body.selectedNodeId.length > 100)) return NextResponse.json({ error: "画布节点编号无效" }, { status: 400 });
  let messages, skills;
  try {
    messages = validateAgentMessages(body.messages);
    skills = productionAgentSkillContext(Array.isArray(body.skillIds) ? body.skillIds as string[] : []);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "对话或 Skill 无效" }, { status: 400 }); }
  let model;
  try { model = labTextModels().find((item) => item.id === body.model); }
  catch { return NextResponse.json({ error: "独立模型配置无效" }, { status: 503 }); }
  if (!model) return NextResponse.json({ error: "所选文本模型尚未配置" }, { status: 503 });

  let state;
  try { state = await readLab(); } catch { return NextResponse.json({ error: "独立项目数据库尚未初始化" }, { status: 503 }); }
  const project = state.projects.find((item) => item.id === body.projectId);
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (project.ownerId !== actor.id && !actor.reviewer) return NextResponse.json({ error: "无权访问此项目" }, { status: 403 });
  const task = state.tasks.find((item) => item.projectId === project.id && item.episode === body.episode);
  if (!["立项草案", "剧本开发", "样片制作", "批量制作"].includes(project.stage)) return NextResponse.json({ error: "当前项目阶段暂不接受画布 Agent 规划" }, { status: 409 });

  let graph;
  try {
    const row = await readProjectCanvas(project.id, Number(body.episode));
    if (!row) return NextResponse.json({ error: "当前分集画布尚未同步，请等待画布状态显示“已同步”后重试" }, { status: 409 });
    graph = validateCanvasGraph(row.document);
  } catch { return NextResponse.json({ error: "无法读取第六板块分集画布；请检查独立数据库迁移" }, { status: 503 }); }
  const selectedNode = typeof body.selectedNodeId === "string" ? graph.nodes.find((node) => node.id === body.selectedNodeId) : undefined;
  if (body.selectedNodeId && !selectedNode) return NextResponse.json({ error: "选中节点尚未同步或已删除，请重新选择" }, { status: 409 });

  const system = productionAgentSystemPrompt({ project, task, episode: Number(body.episode), canvasSummary: summarizeProductionCanvas(graph, typeof body.selectedNodeId === "string" ? body.selectedNodeId : undefined), skills: skills.text });
  try {
    const upstream = await fetch(model.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify({ model: model.model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 1800 }),
      signal: AbortSignal.timeout(60000),
      redirect: "error",
      cache: "no-store",
    });
    if (!upstream.ok) return NextResponse.json({ error: `文本模型返回 ${upstream.status}` }, { status: 502 });
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "模型没有返回对话内容" }, { status: 502 });
    const result = parseAgentResult(content);
    if (result.drafts.some(draft => draft.type === "update-selected") && !selectedNode) return NextResponse.json({ error: "修改节点草案没有有效的选中节点，请重新选择后再试" }, { status: 502 });
    return NextResponse.json({ ...result, skillVersions: skills.versions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "制作 Agent 请求失败；没有发起媒体生成" }, { status: 502 });
  }
}
