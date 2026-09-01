import { NextResponse } from "next/server";

import { COMPANY_PRODUCTION_STAGES, type CompanyProductionActiveStage } from "@/lib/creator/company-production-run";
import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from "@/lib/ai/catalog";
import { ensureCreatorWorkspace } from "@/lib/creator/workspace";
import type { CreatorProduction, CreatorProductionStatus } from "@/lib/creator/types";
import { createClient } from "@/lib/local/server";

export const runtime = "nodejs";

const MAX_STATE_BYTES = 700_000;
const STATUSES: CreatorProductionStatus[] = ["draft", "planning", "ready", "rendering", "assembling", "succeeded", "failed"];
const STAGES: CompanyProductionActiveStage[] = [...COMPANY_PRODUCTION_STAGES, "complete"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown, fallback = "") {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === "string" ? value : fallback;
}

function normalizeProduction(value: unknown): CreatorProduction | null {
  const row = asRecord(value);
  const id = typeof row.id === "string" ? row.id : "";
  const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : "";
  const sessionId = typeof row.session_id === "string" ? row.session_id : "";
  if (!id || !workspaceId || !sessionId) return null;
  const createdAt = dateString(row.created_at);
  return {
    id,
    workspace_id: workspaceId,
    session_id: sessionId,
    canvas_project_id: typeof row.canvas_project_id === "string" ? row.canvas_project_id : null,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "未命名制片项目",
    stage: typeof row.stage === "string" ? row.stage : "research",
    status: STATUSES.includes(row.status as CreatorProductionStatus) ? row.status as CreatorProductionStatus : "draft",
    state: asRecord(row.state),
    created_at: createdAt,
    updated_at: dateString(row.updated_at, createdAt),
  };
}

async function productionContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc("ensure_creator_workspace"),
    load: async (id) => localClient.from("creator_workspaces").select("*").eq("id", id).single(),
  }, user.id);
  return { localClient, user, workspace };
}

export async function GET(req: Request) {
  try {
    const context = await productionContext();
    if (!context) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const productionId = new URL(req.url).searchParams.get("productionId");
    let query = context.localClient.from("creator_productions").select("*").eq("workspace_id", context.workspace.id);
    if (productionId) query = query.eq("id", productionId);
    const result = productionId
      ? await query.maybeSingle()
      : await query.order("updated_at", { ascending: false });
    if (result.error) throw result.error;
    if (productionId) {
      const production = normalizeProduction(result.data);
      if (!production) return NextResponse.json({ error: "制片项目不存在" }, { status: 404 });
      return NextResponse.json({ production });
    }
    const productions = (Array.isArray(result.data) ? result.data : []).map(normalizeProduction).filter((item): item is CreatorProduction => Boolean(item));
    return NextResponse.json({ productions });
  } catch (error) {
    console.error("[creator productions read]", error);
    return NextResponse.json({ error: "读取制片项目失败，请稍后重试" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const context = await productionContext();
    if (!context) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = asRecord(await req.json().catch(() => ({})));
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "未命名制片项目";
    const model = typeof body.model === "string" && isTextModelId(body.model) ? body.model : DEFAULT_TEXT_MODEL_ID;
    const initialState = asRecord(body.state);
    if (JSON.stringify(initialState).length > MAX_STATE_BYTES) return NextResponse.json({ error: "制片项目数据过大" }, { status: 400 });

    const sessionResult = await context.localClient.from("creator_sessions").insert({
      workspace_id: context.workspace.id,
      kind: "video",
      title,
      default_model: model,
    }).select("*").single();
    if (sessionResult.error || !sessionResult.data) throw sessionResult.error || new Error("创建制片会话失败");

    const productionResult = await context.localClient.from("creator_productions").insert({
      workspace_id: context.workspace.id,
      session_id: sessionResult.data.id,
      title,
      state: initialState,
      stage: "research",
      status: "draft",
    }).select("*").single();
    if (productionResult.error || !productionResult.data) {
      await context.localClient.from("creator_sessions").delete().eq("id", sessionResult.data.id).eq("workspace_id", context.workspace.id);
      throw productionResult.error || new Error("创建制片项目失败");
    }
    const production = normalizeProduction(productionResult.data);
    if (!production) throw new Error("制片项目数据无效");
    return NextResponse.json({ production }, { status: 201 });
  } catch (error) {
    console.error("[creator productions create]", error);
    return NextResponse.json({ error: "创建制片项目失败，请稍后重试" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const context = await productionContext();
    if (!context) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = asRecord(await req.json().catch(() => ({})));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "缺少制片项目 ID" }, { status: 400 });
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string" && body.title.trim()) changes.title = body.title.trim().slice(0, 120);
    if (typeof body.canvasProjectId === "string") changes.canvas_project_id = body.canvasProjectId.slice(0, 160);
    if (typeof body.stage === "string" && STAGES.includes(body.stage as CompanyProductionActiveStage)) changes.stage = body.stage;
    if (typeof body.status === "string" && STATUSES.includes(body.status as CreatorProductionStatus)) changes.status = body.status;
    if (typeof body.state !== "undefined") {
      const state = asRecord(body.state);
      if (JSON.stringify(state).length > MAX_STATE_BYTES) return NextResponse.json({ error: "制片项目数据过大" }, { status: 400 });
      changes.state = state;
    }
    const result = await context.localClient.from("creator_productions")
      .update(changes)
      .eq("id", id)
      .eq("workspace_id", context.workspace.id)
      .select("*")
      .maybeSingle();
    if (result.error) throw result.error;
    const production = normalizeProduction(result.data);
    if (!production) return NextResponse.json({ error: "制片项目不存在" }, { status: 404 });
    if (typeof changes.title === "string") {
      await context.localClient.from("creator_sessions")
        .update({ title: changes.title, updated_at: changes.updated_at })
        .eq("id", production.session_id)
        .eq("workspace_id", context.workspace.id);
    }
    return NextResponse.json({ production });
  } catch (error) {
    console.error("[creator productions update]", error);
    return NextResponse.json({ error: "保存制片项目失败，请稍后重试" }, { status: 500 });
  }
}
