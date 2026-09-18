/**
 * Convert provider and gateway diagnostics into a stable, user-facing
 * Chinese message.  Provider text is still kept in server logs; it must not
 * be copied verbatim into a canvas card because it is often English, vague,
 * or contains implementation details that users cannot act on.
 */

export type ProviderErrorMessageOptions = {
  status?: number;
  fallback?: string;
  subject?: "image" | "video" | "reference";
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Extract the useful message from axios/fetch/provider JSON envelopes. */
export function extractProviderErrorMessage(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      const nested = extractProviderErrorMessage(parsed);
      return nested || text;
    } catch {
      return text;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = readRecord(value);
  const error = record.error;
  const nestedError = readRecord(error);
  return extractProviderErrorMessage(record.message)
    || extractProviderErrorMessage(record.msg)
    || extractProviderErrorMessage(record.detail)
    || extractProviderErrorMessage(typeof error === "string" ? error : nestedError.message)
    || extractProviderErrorMessage(nestedError.detail)
    || extractProviderErrorMessage(record.reason)
    || extractProviderErrorMessage(record.status_message)
    || "";
}

function safeDetail(value: string) {
  return compact(value)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "[已隐藏]")
    .replace(/([?&](?:token|key|signature|sig)=)[^&\s]+/gi, "$1***");
}

function statusMessage(status: number | undefined, subject: ProviderErrorMessageOptions["subject"], fallback: string) {
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
  if (status === 408 || status === 504) return "模型服务响应超时，任务可能仍在处理中；请稍后查看生成记录，不要重复提交";
  if (status === 429) return "模型服务请求过于频繁或额度不足，请稍后重试";
  if (status === 404) return "接口地址不存在（404），请检查 Base URL 和模型选择";
  if (status === 502 || status === 503) return "模型服务或网络网关暂时不可用，请稍后重试";
  if (status && status >= 500) return fallback.includes("稍后重试")
    ? `${fallback}；模型服务暂时不可用`
    : `${fallback}，模型服务暂时不可用，请稍后重试`;
  if (status === 400 && subject === "image") return "图片模型参数或参考素材不符合要求，请检查尺寸、格式和参考图后重试";
  return "";
}

/**
 * Known provider diagnostics are deliberately matched by meaning instead of
 * by one gateway's exact punctuation.  This covers both Wetoken and the
 * upstream model messages shown in the admin log screenshots.
 */
export function normalizeProviderErrorMessage(value: unknown, options: ProviderErrorMessageOptions = {}) {
  const fallback = options.fallback || (options.subject === "video" ? "视频生成失败" : options.subject === "reference" ? "参考素材处理失败" : "图片生成失败");
  const statusFallback = statusMessage(options.status, options.subject, fallback);
  const source = safeDetail(extractProviderErrorMessage(value));
  const text = source.toLowerCase();

  if (/(failed\s*to\s*fetch|load\s*failed|network\s*(?:error|request|changed|unreachable)|err[_ -]?network|econnreset|etimedout|enotfound|dns\s*(?:error|failure)|socket\s*(?:hang\s*up|timeout)|connection\s*(?:reset|closed|timed\s*out)|gateway\s*timeout|upstream\s*(?:timeout|unavailable))/.test(text)) {
    return "网络出现波动，模型服务暂时无法访问；任务可能仍在处理中，请稍后查看记录或重试";
  }

  if (/(copyright(?:ed)?|copy\s*right|content\s*(?:policy|safety|moderation|filter)|safety\s*(?:system|policy|filter)|policy\s*(?:violation|reject|block)|moderation|rights?\s*(?:check|restriction|violation)|sensitive\s*content|content[_ -]?filter|risk\s*control|blocked\s+for\s+safety|illegal\s+content|版权|著作权|内容安全|安全审核|违规内容|风险控制)/i.test(source)) {
    return options.subject === "reference"
      ? "参考素材触发了供应商版权或内容安全限制，请更换素材或确认已获得授权后重试"
      : "提示词或参考素材触发了供应商版权或内容安全限制，请修改提示词、更换素材或确认已获得授权后重试";
  }

  if (/(width|height).*(?:between|range|300\s*px.*6000\s*px)|(?:300\s*px.*6000\s*px).*(width|height)/i.test(source)) {
    return "参考图或参考视频的宽和高均需在 300–6000px 之间，请裁剪、缩放或更换素材后重试";
  }
  if (/duration.*(?:between|range).*1\.8\s*s.*30\.2\s*s|1\.8\s*s.*30\.2\s*s.*duration/i.test(source)) {
    return "参考视频时长需在 1.8–30.2 秒之间，请裁剪后重新上传";
  }
  if (/(?:unsupported|invalid).*(?:codec|format|mime|file\s*type)|(?:codec|format|mime|file\s*type).*not\s+supported/i.test(source)) {
    return "参考素材格式或编码不受支持；图片请使用 JPG、PNG 或 WebP，视频请使用 MP4 或 MOV";
  }
  if (/(?:file\s*)?size.*(?:too\s*large|too\s*small|exceed|over\s*(?:the\s*)?limit|between\s*300\s*kb.*7\s*mb|less\s+than\s*300\s*kb|at\s*least\s*300\s*kb)|(?:too\s*large|超过\s*7\s*mb)/i.test(source)) {
    return "参考图片大小需在 300KB–7MB 之间，请压缩、放大或更换图片后重试";
  }

  // This is an output-size error, not a reference-file-size error. Keeping
  // the pixel count in the Chinese message makes the setting easy to fix.
  const minPixels = source.match(/(?:at\s*least|minimum(?:\s*of)?|至少)\s*([\d,]+)\s*pixels?/i);
  if (/parameter\s*[`'\"]?size|image\s*size.*pixels?|像素总数|输出尺寸/i.test(source) && minPixels) {
    const pixels = minPixels[1].replace(/,/g, "");
    return `当前模型要求输出图片至少 ${pixels} 像素，请在图片设置中调高清晰度或更换支持的输出尺寸后重试`;
  }
  if (/parameter\s*[`'\"]?size.*(?:not\s+valid|invalid)|invalid.*(?:image\s*)?size/i.test(source)) {
    return "当前模型不支持所选输出尺寸，请在图片设置中选择支持的尺寸或清晰度后重试";
  }
  if (/outputmime|imageconfig.*(?:required|invalid)/i.test(source)) {
    // Keep the field name because it points developers to the exact setting,
    // while the surrounding guidance remains understandable to users.
    return "图片模型参数 imageConfig.outputMIMEType 不完整或不受支持，请检查模型配置后重试";
  }
  if (/(?:aspect\s*)?ratio.*(?:not\s+valid|invalid|unsupported)|(?:not\s+valid|invalid|unsupported).*(?:aspect\s*)?ratio|画幅比例|视频比例.*(?:无效|不支持)/i.test(source)) {
    return "视频画幅比例不受支持，请选择模型支持的比例后重试";
  }
  if (/(?:url|download|fetch|access|permission|forbidden|not\s*found).*(?:reference|asset|source|素材)?/i.test(source) && options.subject === "reference") {
    return "参考素材地址暂时无法读取，请重新上传素材并稍后重试";
  }

  if (statusFallback) return statusFallback;
  const hasUnmappedEnglishDiagnostic = /\b(?:the|parameter|request|response|failed|failure|error|invalid|unsupported|must|specified|gateway|provider|upstream)\b/i.test(source);
  if (/[\u4e00-\u9fff]/.test(source) && !hasUnmappedEnglishDiagnostic) return source;
  // Never put an unrecognised English provider paragraph on a canvas node.
  return fallback;
}
