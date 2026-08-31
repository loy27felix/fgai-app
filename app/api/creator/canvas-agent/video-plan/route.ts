import { NextResponse } from "next/server";

import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from "@/lib/ai/catalog";
import { chatWithTextModel } from "@/lib/ai/text";
import { normalizeReasoningEffort } from "@/lib/ai/reasoning";
import { ensureCreatorWorkspace } from "@/lib/creator/workspace";
import { createClient } from "@/lib/local/server";
import { buildTextLedgerEntry, recordUsageBestEffort } from "@/lib/usage/ledger";
import { assertMonthlyBudgetAvailable, estimateTextBudgetUsd } from "@/lib/usage/budget";
import { attachTraceId, logServerEvent, logServerFailure, requestTraceId } from "@/lib/observability/server-log";
import { recordAuditEvent } from "@/lib/observability/audit-event";

export const runtime = "nodejs";
export const maxDuration = 60;

type VideoPlanBody = {
  model?: string;
  reasoningEffort?: unknown;
  skill?: unknown;
  brief?: unknown;
  subject?: unknown;
  visualDirection?: unknown;
  ratio?: unknown;
  duration?: unknown;
  referenceNames?: unknown;
};

type ActiveSkill = { name: string; content: string };

function normalizeSkill(input: unknown): ActiveSkill | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { name?: unknown; content?: unknown };
  if (typeof value.name !== "string" || typeof value.content !== "string") return null;
  const name = value.name.trim().slice(0, 80);
  const content = value.content.trim().slice(0, 30_000);
  return name && content ? { name, content } : null;
}

function compactText(input: unknown, limit: number) {
  return typeof input === "string" ? input.trim().slice(0, limit) : "";
}

function normalizeRatio(input: unknown) {
  return typeof input === "string" && ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(input) ? input : "16:9";
}

function normalizeDuration(input: unknown) {
  const value = typeof input === "number" ? input : Number(input);
  return [4, 5, 6, 8, 10, 15].includes(value) ? value : 5;
}

function normalizeReferenceNames(input: unknown) {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 140)).filter(Boolean).slice(0, 8)
    : [];
}

function buildVideoPlanMessages(input: {
  skill: ActiveSkill;
  brief: string;
  subject: string;
  visualDirection: string;
  ratio: string;
  duration: number;
  referenceNames: string[];
}) {
  return [
    {
      role: "system" as const,
      content: "你是 FG Studio 的视频创作导演。根据用户选定的 Skill 和制作问卷，输出一段可直接交给视频模型的完整中文提示词。只输出最终提示词本身，不要 Markdown、标题、解释、清单或声称已经生成视频。提示词要包含主体、动作/故事节奏、镜头、环境、光影和风格；遵守用户对画幅、时长与参考素材的要求。不要虚构参考素材中不可见的事实。",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        selectedSkill: input.skill,
        productionBrief: input.brief,
        subjectAndStory: input.subject || "未额外填写",
        visualAndCameraDirection: input.visualDirection || "未额外填写",
        aspectRatio: input.ratio,
        durationSeconds: input.duration,
        uploadedCanvasReferences: input.referenceNames,
      }),
    },
  ];
}

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  const respond = (body: unknown, init?: ResponseInit) => attachTraceId(NextResponse.json(body, init), traceId);
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) {
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", reason: "unauthenticated" }, "warn");
    return respond({ error: "未登录" }, { status: 401 });
  }

  let body: VideoPlanBody;
  try {
    body = await req.json();
  } catch (error) {
    logServerFailure("canvas_skill_video", error, { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, reason: "invalid_json" });
    return respond({ error: "请求体格式错误" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model : DEFAULT_TEXT_MODEL_ID;
  const skill = normalizeSkill(body.skill);
  const brief = compactText(body.brief, 4_000);
  const subject = compactText(body.subject, 4_000);
  const visualDirection = compactText(body.visualDirection, 4_000);
  const ratio = normalizeRatio(body.ratio);
  const duration = normalizeDuration(body.duration);
  const referenceNames = normalizeReferenceNames(body.referenceNames);
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);

  if (!skill || !brief) {
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, reason: "missing_skill_or_brief" }, "warn");
    return respond({ error: "请先选择 Skill 并填写创作目标" }, { status: 400 });
  }
  if (!isTextModelId(model)) {
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, reason: "unsupported_model" }, "warn");
    return respond({ error: "不支持的模型" }, { status: 400 });
  }

  let workspaceId: string | undefined;
  const startedAt = Date.now();
  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => localClient.rpc("ensure_creator_workspace"),
      load: async (id) => localClient.from("creator_workspaces").select("*").eq("id", id).single(),
    }, user.id);
    workspaceId = workspace.id;
    const messages = buildVideoPlanMessages({ skill, brief, subject, visualDirection, ratio, duration, referenceNames });
    const budget = await assertMonthlyBudgetAvailable({
      userId: user.id,
      estimatedCostUsd: estimateTextBudgetUsd({ model, inputText: JSON.stringify(messages), maxOutputTokens: 1_800 }),
    });
    if (!budget.allowed) {
      logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, workspaceId, model, reason: budget.code || "monthly_budget" }, "warn");
      return respond({ error: budget.message, code: budget.code }, { status: 402 });
    }

    logServerEvent("canvas_skill_video", {
      traceId,
      feature: "canvas_skill_video",
      stage: "provider_started",
      actorId: user.id,
      workspaceId,
      model,
      skillName: skill.name,
      referenceCount: referenceNames.length,
      ratio,
      duration,
    });
    await recordAuditEvent({
      traceId,
      actorId: user.id,
      workspaceId,
      feature: "canvas_skill_video",
      action: "plan_video",
      resourceType: "canvas_skill",
      resourceId: skill.name,
      stage: "received",
      outcome: "started",
      parameters: { model, ratio, duration, referenceCount: referenceNames.length, reasoningEffort },
    });

    const { spec, result } = await chatWithTextModel({
      modelId: model,
      messages,
      thinking: reasoningEffort !== "auto",
      reasoningEffort,
      maxTokens: 1_800,
    });
    const prompt = result.content.trim();
    if (!prompt) throw new Error("模型没有返回可用的视频提示词");

    const ledgerRecorded = await recordUsageBestEffort(buildTextLedgerEntry({
      userId: user.id,
      workspaceId,
      provider: spec.provider,
      model: spec.id,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    }));
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "completed", actorId: user.id, workspaceId, model: spec.id, durationMs: Date.now() - startedAt, referenceCount: referenceNames.length, ledgerRecorded });
    await recordAuditEvent({
      traceId,
      actorId: user.id,
      workspaceId,
      feature: "canvas_skill_video",
      action: "plan_video",
      resourceType: "canvas_skill",
      resourceId: skill.name,
      stage: "completed",
      outcome: "succeeded",
      durationMs: Date.now() - startedAt,
      parameters: { model: spec.id, ratio, duration, referenceCount: referenceNames.length },
      data: { usagePresent: Boolean(result.usage), ledgerRecorded },
    });
    return respond({ prompt, model: spec.id, usage: result.usage });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "视频制作计划生成失败";
    logServerFailure("canvas_skill_video", error, { traceId, feature: "canvas_skill_video", stage: "failed", actorId: user.id, workspaceId, model, skillName: skill?.name });
    await recordAuditEvent({
      traceId,
      actorId: user.id,
      workspaceId,
      feature: "canvas_skill_video",
      action: "plan_video",
      resourceType: "canvas_skill",
      resourceId: skill?.name,
      stage: "failed",
      outcome: "failed",
      parameters: { model, ratio, duration, referenceCount: referenceNames.length },
      error,
      level: "error",
    });
    return respond({ error: detail }, { status: 500 });
  }
}
