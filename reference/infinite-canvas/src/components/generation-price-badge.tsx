import { CircleDollarSign } from "lucide-react";

import { estimateImagePrice, estimateVideoPrice } from "@/lib/usage/pricing";
import { getUsdToCnyRate } from "@/lib/usage/fx";
import { modelOptionName } from "@/reference/infinite-canvas/src/stores/use-config-store";

type GenerationPriceBadgeProps = {
    kind: "image" | "video";
    model: string;
    size?: string;
    count?: number;
    duration?: number | string;
    resolution?: string;
    ratio?: string;
    hasVideoReference?: boolean;
    className?: string;
};

/** A preflight estimate only; the trusted usage ledger remains the source of truth. */
export function GenerationPriceBadge({ kind, model, size = "", count = 1, duration = 0, resolution = "", ratio = "", hasVideoReference = false, className = "" }: GenerationPriceBadgeProps) {
    const modelName = modelOptionName(model);
    const normalizedVideoResolution = String(resolution).trim().toLowerCase();
    const priceResolution = normalizedVideoResolution === "4k" || normalizedVideoResolution.endsWith("p")
        ? normalizedVideoResolution
        : normalizedVideoResolution
            ? `${normalizedVideoResolution}p`
            : "";
    const pricing = kind === "image"
        ? estimateImagePrice(modelName, size)
        : estimateVideoPrice({
            model: modelName,
            duration: Math.max(0, Math.floor(Number(duration) || 0)),
            resolution: priceResolution,
            ratio,
            hasVideoReference,
        });
    const units = kind === "image" ? Math.max(1, Math.floor(Number(count) || 1)) : 1;
    const totalUsd = pricing ? pricing.estimatedCostUsd * units : null;
    const totalCny = totalUsd === null ? null : totalUsd * getUsdToCnyRate();
    const videoSeconds = Math.max(0, Math.floor(Number(duration) || 0));
    const perSecondCny = kind === "video" && totalCny !== null && videoSeconds > 0 ? totalCny / videoSeconds : null;
    const unitLabel = kind === "image" ? (units > 1 ? String(units) + " 张" : "1 张") : String(videoSeconds) + " 秒";

    return (
        <div className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 text-xs ${className}`} style={{ borderColor: "rgba(120,113,108,.28)", color: "var(--foreground, #292524)", background: "color-mix(in srgb, var(--card, #fff) 78%, transparent)" }} title={pricing ? `按已确认价格预估：${pricing.snapshot.note || ""}` : hasVideoReference ? "参考视频会影响 Seedance token 用量；当前版本尚未保存其时长，因此不显示可能错误的预估价。" : kind === "image" ? "该模型当前仅公开 Token 区间或起售价，无法可靠换算为单张价格；生成完成后以 Wetoken 账单为准。" : "该模型组合暂无已确认价格；实际供应商扣费仍会写入用量账本"}>
            <CircleDollarSign className="size-3.5 shrink-0 opacity-70" />
            {totalCny === null ? (
                <span className="truncate opacity-70">价格待确认</span>
            ) : (
                <span className="truncate">
                    预计 <strong className="font-semibold">¥{totalCny.toFixed(2)}</strong>
                    <span className="ml-1 opacity-60">(${totalUsd!.toFixed(4)} · {unitLabel}{perSecondCny === null ? "" : " · ¥" + perSecondCny.toFixed(2) + "/秒"})</span>
                </span>
            )}
        </div>
    );
}
