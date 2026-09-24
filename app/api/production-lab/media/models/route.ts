import { NextResponse } from "next/server";
import { IMG_MODELS, imageOutputSizeOptionsFor } from "@/lib/imageModels";
import { VIDEO_MODELS } from "@/lib/ai/video";
import { isProviderReachableAssetSourceUrl } from "@/lib/ai/wetoken-assets";
import { labActor } from "@/lib/production-lab/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!await labActor()) return NextResponse.json({ error: "无试用权限" }, { status: 403 });
  return NextResponse.json({
    images: IMG_MODELS.map((model) => ({ id: model.id, label: model.label, experimental: model.experimental, sizes: imageOutputSizeOptionsFor(model.id), maxReferences: Math.min(4, model.maxReferences) })),
    videos: VIDEO_MODELS.map((model) => ({ id: model.id, label: model.label, resolutions: model.resolutions, ratios: model.ratios, minDuration: model.minDuration, maxDuration: model.maxDuration, minImageReferences: model.minImageReferences, maxImageReferences: model.maxImageReferences, imageRoles: model.imageRoles, supportsAudioGeneration: model.supportsAudioGeneration })),
    wetokenConfigured: Boolean(process.env.WETOKEN_API_KEY),
    videoReferencesReady: isProviderReachableAssetSourceUrl(process.env.PROVIDER_MEDIA_URL || ""),
  });
}
