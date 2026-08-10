export const REASONING_EFFORT_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" },
  { value: "ultra", label: "Ultra" },
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number]["value"];

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return REASONING_EFFORT_OPTIONS.some((item) => item.value === value)
    ? (value as ReasoningEffort)
    : "auto";
}

export function reasoningEffortLabel(value: unknown) {
  return REASONING_EFFORT_OPTIONS.find((item) => item.value === value)?.label || "自动";
}

/** Keep provider-specific fallbacks in one place so the UI can expose richer presets safely. */
export function providerReasoningEffort(value: unknown, provider: "deepseek" | "wetoken") {
  const normalized = normalizeReasoningEffort(value);
  if (normalized === "auto") return undefined;
  if (provider === "deepseek" && (normalized === "max" || normalized === "ultra")) return "high";
  if (provider === "wetoken" && normalized === "ultra") return "xhigh";
  return normalized;
}
