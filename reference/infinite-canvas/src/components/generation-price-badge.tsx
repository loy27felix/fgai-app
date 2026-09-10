import { CircleDollarSign } from "lucide-react";

import { estimateImagePrice, estimateVideoPrice } from "@/lib/usage/pricing";
import { getUsdToCnyRate } from "@/lib/usage/fx";
import { imageOutputSizeOptionsFor, imageQualityForOutputSize, imageRequestSizeForModel } from "@/lib/imageModels";
import { modelOptionName } from "@/reference/infinite-canvas/src/stores/use-config-store";

type GenerationPriceBadgeProps = {
    kind: "image" | "video";
    model: string;
    size?: string;
    imageQuality?: string;
    count?: number;
    duration?: number | string;
    resolution?: string;
    ratio?: string;
    hasVideoReference?: boolean;
    imageReferenceCount?: number;
    videoReferenceSeconds?: number;
    className?: string;
};

/** A preflight estimate only; the trusted usage ledger remains the source of truth. */
export function GenerationPriceBadge({ kind, model, size = "", imageQuality = "", count = 1, duration = 0, resolution = "", ratio = "", hasVideoReference = false, imageReferenceCount = 0, videoReferenceSeconds = 0, className = "" }: GenerationPriceBadgeProps) {
    const modelName = modelOptionName(model);
    // The editor stores ratio and quality separately. Price the same concrete
    // geometry that the request builder will submit, including Dola's pixel tier.
    const imagePriceQuality = imageQuality === "auto" || !imageQuality
        ? imageQualityForOutputSize(imageOutputSizeOptionsFor(modelName)[0] || "1K")
        : imageQuality;
    const imagePriceSize = imageRequestSizeForModel(modelName, size, imagePriceQuality) || size;
    const normalizedVideoResolution = String(resolution).trim().toLowerCase();
    const priceResolution = normalizedVideoResolution === "4k" || normalizedVideoResolution.endsWith("p")
        ? normalizedVideoResolution
        : normalizedVideoResolution
            ? `${normalizedVideoResolution}p`
            : "";
    const pricing = kind === "image"
        ? estimateImagePrice(modelName, imagePriceSize, { referenceCount: imageReferenceCount })
        : estimateVideoPrice({
            model: modelName,
            duration: Math.max(0, Math.floor(Number(duration) || 0)),
            resolution: priceResolution,
            ratio,
            hasVideoReference,
            imageReferenceCount,
            videoReferenceSeconds,
        });
    const units = kind === "image" ? Math.max(1, Math.floor(Number(count) || 1)) : 1;
    const totalUsd = pricing ? pricing.estimatedCostUsd * units : null;
    const totalCny = totalUsd === null ? null : totalUsd * getUsdToCnyRate();
    const videoSeconds = Math.max(0, Math.floor(Number(duration) || 0));
    const perSecondCny = kind === "video" && totalCny !== null && videoSeconds > 0 ? totalCny / videoSeconds : null;
    const unitLabel = kind === "image" ? (units > 1 ? String(units) + " 张" : "1 张") : String(videoSeconds) + " 秒";

    return (
        <div className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 text-xs ${className}`} style={{ borderColor: "rgba(120,113,108,.28)", color: "var(--foreground, #292524)", background: "color-mix(in srgb, var(--card, #fff) 78%, transparent)" }} title={pricing ? `按已确认价格预估：${pricing.snapshot.note || ""}` : "当前模型或参数不在价格目录中"}>
            <CircleDollarSign className="size-3.5 shrink-0 opacity-70" />
            {totalCny === null ? (
                <span className="truncate opacity-70">价格配置缺失</span>
            ) : (
                <span className="truncate">
                    预计 <strong className="font-semibold">¥{totalCny.toFixed(2)}</strong>
                    <span className="ml-1 opacity-60">({unitLabel}{perSecondCny === null ? "" : " · ¥" + perSecondCny.toFixed(2) + "/秒"})</span>
                </span>
            )}
        </div>
    );
}
