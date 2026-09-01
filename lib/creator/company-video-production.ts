import { estimateImagePrice, estimateVideoPrice } from "@/lib/usage/pricing";

export type CompanyVideoProductionInput = {
  videoModel: string;
  videoResolution: string;
  secondsPerSegment: number;
  segmentCount: number;
  storyboardModel: string;
  storyboardResolution: string;
};

export type CompanyVideoProductionQuote = {
  storyboardCount: number;
  segmentCount: number;
  storyboardCostUsd: number | null;
  videoCostUsd: number | null;
  totalCostUsd: number | null;
  hasUnpricedItems: boolean;
};

function modelName(value: string) {
  const separator = "::";
  const index = value.indexOf(separator);
  return (index >= 0 ? value.slice(index + separator.length) : value).trim();
}

function boundedCount(value: number) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) ? Math.min(4, Math.max(1, numeric)) : 1;
}

/**
 * A quote used before the user confirms a Company Model production run.
 * It intentionally returns null instead of inventing a cost for a model whose
 * provider pricing is not in the verified FG Studio price catalog.
 */
export function estimateCompanyVideoProduction(input: CompanyVideoProductionInput): CompanyVideoProductionQuote {
  const segmentCount = boundedCount(input.segmentCount);
  const storyboardCount = segmentCount;
  const perStoryboard = estimateImagePrice(modelName(input.storyboardModel), input.storyboardResolution);
  const perVideo = estimateVideoPrice({
    model: modelName(input.videoModel),
    duration: input.secondsPerSegment,
    resolution: input.videoResolution,
  });
  const storyboardCostUsd = perStoryboard
    ? Number((perStoryboard.estimatedCostUsd * storyboardCount).toFixed(6))
    : null;
  const videoCostUsd = perVideo
    ? Number((perVideo.estimatedCostUsd * segmentCount).toFixed(6))
    : null;

  return {
    storyboardCount,
    segmentCount,
    storyboardCostUsd,
    videoCostUsd,
    totalCostUsd: storyboardCostUsd !== null && videoCostUsd !== null
      ? Number((storyboardCostUsd + videoCostUsd).toFixed(6))
      : null,
    hasUnpricedItems: storyboardCostUsd === null || videoCostUsd === null,
  };
}

export function normalizeCompanyVideoSegmentCount(value: unknown) {
  return boundedCount(typeof value === "number" ? value : Number(value));
}
