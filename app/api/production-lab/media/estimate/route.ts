import { NextResponse } from "next/server";
import { getImageModel, imageOutputSizeOptionsFor } from "@/lib/imageModels";
import { getVideoModel } from "@/lib/ai/video";
import { estimateImagePrice, estimateVideoPrice } from "@/lib/usage/pricing";
import { assertMonthlyBudgetAvailable } from "@/lib/usage/budget";
import { labActor } from "@/lib/production-lab/access";
import { hasSameOriginLabRequest } from "@/lib/production-lab/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await labActor();
  if (!actor) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  if (!hasSameOriginLabRequest(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  if (!process.env.WETOKEN_API_KEY) return NextResponse.json({ error: "服务端尚未配置 WeToken API Key" }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  const kind = body.kind;
  const model = typeof body.model === "string" ? body.model : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const referenceCount = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds.length : 0;
  if (!prompt || prompt.length > 10000) return NextResponse.json({ error: "请填写 1–10000 字的生成描述" }, { status: 400 });

  let pricing;
  if (kind === "image") {
    const spec = getImageModel(model);
    const size = typeof body.size === "string" ? body.size : "1K";
    if (!spec || !imageOutputSizeOptionsFor(model).includes(size)) return NextResponse.json({ error: "图片模型或尺寸不支持" }, { status: 400 });
    if (!Number.isInteger(referenceCount) || referenceCount > Math.min(4, spec.maxReferences)) return NextResponse.json({ error: `参考图最多 ${Math.min(4, spec.maxReferences)} 张` }, { status: 400 });
    pricing = estimateImagePrice(model, size, { prompt, referenceCount });
  } else if (kind === "video") {
    const spec = getVideoModel(model);
    const duration = Number(body.duration);
    const ratio = typeof body.ratio === "string" ? body.ratio : "9:16";
    const resolution = typeof body.resolution === "string" ? body.resolution : "720p";
    if (!spec || !Number.isInteger(duration) || duration < spec.minDuration || duration > spec.maxDuration || !spec.resolutions.includes(resolution) || !spec.ratios.includes(ratio)) {
      return NextResponse.json({ error: "视频模型、时长、比例或分辨率不支持" }, { status: 400 });
    }
    if (referenceCount < spec.minImageReferences || referenceCount > spec.maxImageReferences) return NextResponse.json({ error: `此模型要求 ${spec.minImageReferences}–${spec.maxImageReferences} 张图片参考` }, { status: 400 });
    pricing = estimateVideoPrice({ model, duration, resolution, ratio, imageReferenceCount: referenceCount });
  } else return NextResponse.json({ error: "生成类型无效" }, { status: 400 });

  const budget = await assertMonthlyBudgetAvailable({ userId: actor.id, estimatedCostUsd: pricing?.estimatedCostUsd });
  return NextResponse.json({
    allowed: budget.allowed,
    budgetMessage: budget.allowed ? null : budget.message,
    estimate: pricing ? { amountUsd: pricing.estimatedCostUsd, note: pricing.snapshot.note, snapshot: pricing.snapshot } : null,
    billing: "用量先按模型估算；导入 WeToken 费用 CSV 后按 Reference ID 精确核对实际账单。",
  });
}
