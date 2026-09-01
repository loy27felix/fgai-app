export type CompanyProductionDirection = {
  id: string;
  title: string;
  hook: string;
  treatment: string;
  visualLanguage: string;
};

function compact(value: unknown, fallback: string, limit = 360) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
}

const FALLBACKS: Array<Omit<CompanyProductionDirection, "id">> = [
  { title: "瞬间惊喜", hook: "用一个第一眼就能懂的发现瞬间抓住注意力。", treatment: "从人物或产品的第一次反应切入，再给出清晰的核心动作与收尾。", visualLanguage: "干净、聚焦主体的电影化近景，动作连续、信息单一。" },
  { title: "节奏推进", hook: "把核心卖点变成一段不断升级的动作挑战。", treatment: "每一段只推进一个动作，让节奏、镜头和情绪逐步加速。", visualLanguage: "明确节拍、可辨识转场与稳定角色连续性的动态镜头。" },
  { title: "情感收束", hook: "先建立人物关系或使用场景，再落到产品带来的变化。", treatment: "用真实可感的情绪完成起承转合，最后把记忆点留在一个干净画面里。", visualLanguage: "自然光感、克制运镜、强调关系与空间氛围。" },
];

/** Turns an unreliable provider answer into exactly three direction cards. */
export function parseCompanyProductionDirections(content: string, fallbackBrief: string): CompanyProductionDirection[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    // The cards below let the user continue even if the provider ignored JSON mode.
  }
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const source = Array.isArray(raw.directions) ? raw.directions : [];
  return Array.from({ length: 3 }, (_, index) => {
    const value = source[index] && typeof source[index] === "object" && !Array.isArray(source[index]) ? source[index] as Record<string, unknown> : {};
    const fallback = FALLBACKS[index];
    return {
      id: `direction-${index + 1}`,
      title: compact(value.title, fallback.title, 80),
      hook: compact(value.hook, fallbackBrief ? `${fallback.hook} 围绕“${fallbackBrief.slice(0, 100)}”。` : fallback.hook),
      treatment: compact(value.treatment, fallback.treatment),
      visualLanguage: compact(value.visualLanguage, fallback.visualLanguage),
    };
  });
}
