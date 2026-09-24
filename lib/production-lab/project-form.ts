export const PROJECT_MARKET_OPTIONS = ["北美", "拉美", "菲律宾", "泰国", "日本", "韩国", "印尼", "巴西", "越南", "待确认"];
export const PROJECT_LANGUAGE_OPTIONS = ["英语", "西班牙语", "葡萄牙语", "他加禄语 / 菲律宾语", "泰语", "日语", "韩语", "印尼语", "越南语", "中文", "待确认"];
export const PROJECT_CHANNEL_OPTIONS = ["短剧 / App", "YouTube", "YouTube Shorts", "TikTok", "Instagram Reels", "Facebook", "待确认"];
export const PROJECT_VISUAL_FORM_OPTIONS = ["2D动画", "3D动画", "AI真人", "动态漫画", "羊毛毡", "黏土定格", "定格动画", "待确认"];

export type ProjectScopeChoices = { markets?: unknown; languages?: unknown; channels?: unknown };

export function selectionValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap((item) => typeof item === "string" ? item.split(/[,，、;；]+/) : [])
    .map((item) => item.trim()).filter(Boolean))];
}

export function defaultProductionGroup(selectionGroup: string | undefined, activeGroupNames: string[]): string | undefined {
  return selectionGroup && activeGroupNames.includes(selectionGroup) ? selectionGroup : undefined;
}

export function formatProjectScope({ markets, languages, channels }: ProjectScopeChoices): string {
  const groups = [
    ["市场", selectionValues(markets)],
    ["语言", selectionValues(languages)],
    ["渠道", selectionValues(channels)],
  ] as const;
  const formatted = groups.map(([label, values]) => {
    const choices = values.length > 1 ? values.filter((value) => value !== "待确认") : values;
    return choices.length ? `${label}：${choices.join("、")}` : "";
  }).filter(Boolean);
  return formatted.join(" · ") || "待确认";
}

export function formatVisualStyle(form: unknown, styleNotes: unknown): string {
  const notes = typeof styleNotes === "string" ? styleNotes.trim() : "";
  let values = [...new Set([...selectionValues(form), ...(notes ? [notes] : [])])];
  if (values.some((value) => value !== "待确认")) values = values.filter((value) => value !== "待确认");
  const normalized = values;
  return normalized.join(" / ") || "待确认";
}
