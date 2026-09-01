import { NextResponse } from "next/server";

import { DEFAULT_TEXT_MODEL_ID, isTextModelId } from "@/lib/ai/catalog";
import { chatWithTextModel } from "@/lib/ai/text";
import { normalizeReasoningEffort } from "@/lib/ai/reasoning";
import { getVideoModel } from "@/lib/ai/video-models";
import { estimateCompanyVideoProduction, normalizeCompanyVideoSegmentCount } from "@/lib/creator/company-video-production";
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
  skills?: unknown;
  brief?: unknown;
  subject?: unknown;
  visualDirection?: unknown;
  ratio?: unknown;
  duration?: unknown;
  segmentCount?: unknown;
  videoModel?: unknown;
  videoResolution?: unknown;
  storyboardModel?: unknown;
  storyboardResolution?: unknown;
  visualImageCount?: unknown;
  visualModel?: unknown;
  visualResolution?: unknown;
  researchMode?: unknown;
  referenceNames?: unknown;
};

type ActiveSkill = { name: string; content: string };
type VideoPlanShot = { title: string; storyboardPrompt: string; videoPrompt: string; duration: number };
type VideoPlan = {
  prompt: string;
  research: { summary: string; searchQueries: string[] };
  script: { title: string; logline: string; beats: string[] };
  visuals: { characters: Array<{ name: string; prompt: string }>; styles: Array<{ name: string; prompt: string }> };
  shots: VideoPlanShot[];
};

function normalizeSkill(input: unknown): ActiveSkill | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { name?: unknown; content?: unknown };
  if (typeof value.name !== "string" || typeof value.content !== "string") return null;
  const name = value.name.trim().slice(0, 80);
  const content = value.content.trim().slice(0, 30_000);
  return name && content ? { name, content } : null;
}

function normalizeSkills(input: unknown, legacy: unknown) {
  const candidates = Array.isArray(input) ? input : [legacy];
  const seen = new Set<string>();
  const skills: ActiveSkill[] = [];
  for (const candidate of candidates) {
    const skill = normalizeSkill(candidate);
    if (!skill || seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
    if (skills.length === 4) break;
  }
  return skills;
}

function compactText(input: unknown, limit: number) {
  return typeof input === "string" ? input.trim().slice(0, limit) : "";
}

function modelName(value: string) {
  const separator = "::";
  const index = value.indexOf(separator);
  return (index >= 0 ? value.slice(index + separator.length) : value).trim();
}

function normalizeRatio(input: unknown) {
  return typeof input === "string" && ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(input) ? input : "16:9";
}

function normalizeDuration(input: unknown, model: string) {
  const value = typeof input === "number" ? input : Number(input);
  const spec = getVideoModel(modelName(model));
  const fallback = spec?.minDuration || 5;
  if (!Number.isFinite(value)) return fallback;
  const seconds = Math.floor(value);
  if (spec) return Math.min(spec.maxDuration, Math.max(spec.minDuration, seconds));
  return [4, 5, 6, 8, 10, 15].includes(seconds) ? seconds : 5;
}

function normalizeReferenceNames(input: unknown) {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 140)).filter(Boolean).slice(0, 8)
    : [];
}

function safePlanText(input: unknown, fallback: string) {
  return typeof input === "string" && input.trim() ? input.trim().slice(0, 8_000) : fallback;
}

function shortList(input: unknown, fallback: string[], limit: number) {
  if (!Array.isArray(input)) return fallback.slice(0, limit);
  const next = input.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 800))
    .filter(Boolean)
    .slice(0, limit);
  return next.length ? next : fallback.slice(0, limit);
}

function visualCards(input: unknown, fallback: Array<{ name: string; prompt: string }>, limit: number) {
  if (!Array.isArray(input)) return fallback.slice(0, limit);
  const cards = input.map((item, index) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      name: safePlanText(value.name, `视觉设定 ${index + 1}`).slice(0, 80),
      prompt: safePlanText(value.prompt, fallback[index]?.prompt || "根据已确认的脚本与调研方向生成视觉参考图。"),
    };
  }).filter((item) => item.prompt).slice(0, limit);
  return cards.length ? cards : fallback.slice(0, limit);
}

function parseVideoPlan(content: string, fallbackPrompt: string, segmentCount: number, duration: number): VideoPlan {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    // The fallback below still gives the user a complete, editable production plan.
  }
  const raw = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const prompt = safePlanText(raw.prompt, content.trim() || fallbackPrompt);
  const researchRecord = raw.research && typeof raw.research === "object" ? raw.research as Record<string, unknown> : {};
  const scriptRecord = raw.script && typeof raw.script === "object" ? raw.script as Record<string, unknown> : {};
  const visualRecord = raw.visuals && typeof raw.visuals === "object" ? raw.visuals as Record<string, unknown> : {};
  const research = {
    summary: safePlanText(researchRecord.summary, `围绕“${fallbackPrompt.slice(0, 120)}”梳理主体、风格、场景与受众记忆点。`),
    searchQueries: shortList(researchRecord.searchQueries, [fallbackPrompt.slice(0, 120) || "视频创作参考"], 6),
  };
  const script = {
    title: safePlanText(scriptRecord.title, "视频创作 Brief").slice(0, 120),
    logline: safePlanText(scriptRecord.logline, fallbackPrompt),
    beats: shortList(scriptRecord.beats, Array.from({ length: segmentCount }, (_, index) => `镜头 ${index + 1}：承接核心目标并推进动作。`), 8),
  };
  const visuals = {
    characters: visualCards(visualRecord.characters, [{ name: "主角设定", prompt: `${prompt}\n\n角色设定图：保证身份、服装、面部与动作连续。` }], 4),
    styles: visualCards(visualRecord.styles, [{ name: "风格设定", prompt: `${prompt}\n\n风格参考图：确定色彩、灯光、构图与材质，不包含文字或水印。` }], 4),
  };
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
  const shots = Array.from({ length: segmentCount }, (_, index): VideoPlanShot => {
    const source = rawShots[index] && typeof rawShots[index] === "object" ? rawShots[index] as Record<string, unknown> : {};
    const shotTitle = safePlanText(source.title, `镜头 ${index + 1}`);
    const storyboardPrompt = safePlanText(source.storyboardPrompt, `${prompt}\n\n这是第 ${index + 1} 段的关键分镜静帧：画幅 ${index + 1} / ${segmentCount}，保持人物、产品、服装、空间与风格连续。`);
    const videoPrompt = safePlanText(source.videoPrompt, `${prompt}\n\n第 ${index + 1} 段，共 ${segmentCount} 段；时长 ${duration} 秒。承接前一段的动作和视觉连续性，完成本段独立、清晰的镜头动作。`);
    return { title: shotTitle, storyboardPrompt, videoPrompt, duration };
  });
  return { prompt, research, script, visuals, shots };
}

function buildVideoPlanMessages(input: {
  skills: ActiveSkill[];
  brief: string;
  subject: string;
  visualDirection: string;
  ratio: string;
  duration: number;
  segmentCount: number;
  referenceNames: string[];
}) {
  return [
    {
      role: "system" as const,
      content: "你是 FG Studio 的视频创作导演。请根据用户选择的多个 Skill 和制作问卷，规划一个可落在画布上的完整制片方案：调研、脚本、角色与风格、分镜静帧、连续视频。只输出有效 JSON，不要 Markdown。格式必须是：{\"prompt\":\"完整中文总提示词\",\"research\":{\"summary\":\"调研结论\",\"searchQueries\":[\"可用于联网找图的检索词\"]},\"script\":{\"title\":\"标题\",\"logline\":\"一句话故事\",\"beats\":[\"节拍\"]},\"visuals\":{\"characters\":[{\"name\":\"角色\",\"prompt\":\"人设图提示词\"}],\"styles\":[{\"name\":\"风格\",\"prompt\":\"风格图提示词\"}]},\"shots\":[{\"title\":\"镜头标题\",\"storyboardPrompt\":\"用于生成该镜头分镜图的中文提示词\",\"videoPrompt\":\"用于生成该段视频的中文提示词\"}]}。shots 数量必须严格等于 segmentCount。每段要保持角色、物体、空间、光线和动作连续，不能把未验证的联网检索结果当作事实。",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        selectedSkills: input.skills,
        productionBrief: input.brief,
        subjectAndStory: input.subject || "未额外填写",
        visualAndCameraDirection: input.visualDirection || "未额外填写",
        aspectRatio: input.ratio,
        secondsPerSegment: input.duration,
        segmentCount: input.segmentCount,
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
  const skills = normalizeSkills(body.skills, body.skill);
  const brief = compactText(body.brief, 4_000);
  const subject = compactText(body.subject, 4_000);
  const visualDirection = compactText(body.visualDirection, 4_000);
  const ratio = normalizeRatio(body.ratio);
  const videoModel = compactText(body.videoModel, 180) || "doubao-seedance-2-0";
  const videoResolution = compactText(body.videoResolution, 40) || "720p";
  const duration = normalizeDuration(body.duration, videoModel);
  const segmentCount = normalizeCompanyVideoSegmentCount(body.segmentCount);
  const storyboardModel = compactText(body.storyboardModel, 180) || "gpt-image-2";
  const storyboardResolution = compactText(body.storyboardResolution, 40) || "1024x1024";
  const visualImageCount = Math.min(12, Math.max(0, Math.floor(Number(body.visualImageCount) || 0)));
  const visualModel = compactText(body.visualModel, 180) || storyboardModel;
  const visualResolution = compactText(body.visualResolution, 40) || storyboardResolution;
  const referenceNames = normalizeReferenceNames(body.referenceNames);
  const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);

  if (!skills.length || !brief) {
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, reason: "missing_skills_or_brief" }, "warn");
    return respond({ error: "请至少选择一个 Skill 并填写创作目标" }, { status: 400 });
  }
  if (!isTextModelId(model)) {
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, reason: "unsupported_model" }, "warn");
    return respond({ error: "不支持的策划模型" }, { status: 400 });
  }

  let workspaceId: string | undefined;
  const startedAt = Date.now();
  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => localClient.rpc("ensure_creator_workspace"),
      load: async (id) => localClient.from("creator_workspaces").select("*").eq("id", id).single(),
    }, user.id);
    workspaceId = workspace.id;
    const messages = buildVideoPlanMessages({ skills, brief, subject, visualDirection, ratio, duration, segmentCount, referenceNames });
    const budget = await assertMonthlyBudgetAvailable({
      userId: user.id,
      estimatedCostUsd: estimateTextBudgetUsd({ model, inputText: JSON.stringify(messages), maxOutputTokens: 2_800 }),
    });
    if (!budget.allowed) {
      logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "rejected", actorId: user.id, workspaceId, model, reason: budget.code || "monthly_budget" }, "warn");
      return respond({ error: budget.message, code: budget.code }, { status: 402 });
    }

    logServerEvent("canvas_skill_video", {
      traceId, feature: "canvas_skill_video", stage: "provider_started", actorId: user.id, workspaceId, model,
      skillNames: skills.map((skill) => skill.name), referenceCount: referenceNames.length, ratio, duration, segmentCount, videoModel: modelName(videoModel),
    });
    await recordAuditEvent({
      traceId, actorId: user.id, workspaceId, feature: "canvas_skill_video", action: "plan_video", resourceType: "canvas_skill", resourceId: skills.map((skill) => skill.name).join(", "), stage: "received", outcome: "started",
      parameters: { model, ratio, duration, segmentCount, videoModel: modelName(videoModel), referenceCount: referenceNames.length, reasoningEffort },
    });

    const { spec, result } = await chatWithTextModel({
      modelId: model, messages, thinking: reasoningEffort !== "auto", reasoningEffort, jsonOutput: true, maxTokens: 2_800,
    });
    const fallbackPrompt = `${brief}\n${subject}\n${visualDirection}`.trim();
    const plan = parseVideoPlan(result.content, fallbackPrompt, segmentCount, duration);
    const quote = estimateCompanyVideoProduction({
      videoModel, videoResolution, secondsPerSegment: duration, segmentCount, storyboardModel, storyboardResolution,
      visualImageCount, visualModel, visualResolution,
    });

    const ledgerRecorded = await recordUsageBestEffort(buildTextLedgerEntry({
      userId: user.id, workspaceId, provider: spec.provider, model: spec.id, usage: result.usage, durationMs: Date.now() - startedAt,
    }));
    logServerEvent("canvas_skill_video", { traceId, feature: "canvas_skill_video", stage: "completed", actorId: user.id, workspaceId, model: spec.id, durationMs: Date.now() - startedAt, referenceCount: referenceNames.length, segmentCount, ledgerRecorded });
    await recordAuditEvent({
      traceId, actorId: user.id, workspaceId, feature: "canvas_skill_video", action: "plan_video", resourceType: "canvas_skill", resourceId: skills.map((skill) => skill.name).join(", "), stage: "completed", outcome: "succeeded", durationMs: Date.now() - startedAt,
      parameters: { model: spec.id, ratio, duration, segmentCount, videoModel: modelName(videoModel), referenceCount: referenceNames.length },
      data: { usagePresent: Boolean(result.usage), ledgerRecorded, quoteKnown: !quote.hasUnpricedItems },
    });
    return respond({ prompt: plan.prompt, plan, quote, model: spec.id, usage: result.usage });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "视频制作计划生成失败";
    logServerFailure("canvas_skill_video", error, { traceId, feature: "canvas_skill_video", stage: "failed", actorId: user.id, workspaceId, model, skillNames: skills.map((skill) => skill.name) });
    await recordAuditEvent({
      traceId, actorId: user.id, workspaceId, feature: "canvas_skill_video", action: "plan_video", resourceType: "canvas_skill", resourceId: skills.map((skill) => skill.name).join(", "), stage: "failed", outcome: "failed",
      parameters: { model, ratio, duration, segmentCount, videoModel: modelName(videoModel), referenceCount: referenceNames.length }, error, level: "error",
    });
    return respond({ error: detail }, { status: 500 });
  }
}
