// Shared prompt parser from reference/infinite-canvas/src/services/api; bundled for the Node gateway.
// Regenerate with production-lab/yingce/build-inspiration-parser.mjs.

// fg-studio-production-pilot/reference/infinite-canvas/src/services/api/prompt-image-url.ts
var PROMPT_IMAGE_PROXY_PATH = "/api/creator/prompt-image?url=";
function toPromptImageUrl(value) {
  const input = value.trim();
  if (!input || input.startsWith("data:") || input.startsWith("blob:") || input.startsWith("/") || input.startsWith(PROMPT_IMAGE_PROXY_PATH)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return input;
    return PROMPT_IMAGE_PROXY_PATH + encodeURIComponent(normalizeGitHubImageUrl(url).toString());
  } catch {
    return input;
  }
}
function promptImageOriginalUrl(value) {
  if (!value.startsWith(PROMPT_IMAGE_PROXY_PATH)) return "";
  try {
    const query = value.slice(PROMPT_IMAGE_PROXY_PATH.indexOf("?") + 1);
    const original = new URLSearchParams(query).get("url")?.trim() || "";
    if (!original) return "";
    const url = new URL(original);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
function normalizeGitHubImageUrl(input) {
  if (input.hostname.toLowerCase() !== "github.com") return input;
  const parts = input.pathname.split("/").filter(Boolean);
  const marker = parts.findIndex((part) => part === "blob" || part === "raw");
  if (parts.length < 4 || marker < 2) return input;
  const owner = parts[0];
  const repo = parts[1];
  const branch = parts[marker + 1];
  const filePath = parts.slice(marker + 2).join("/");
  if (!owner || !repo || !branch || !filePath) return input;
  return new URL("https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/" + filePath);
}

// fg-studio-production-pilot/reference/infinite-canvas/src/services/api/prompt-source-runtime.ts
function parseMarkdownSource(data, source) {
  if (typeof data !== "string") throw new Error(`\u300C${source.name}\u300D\u683C\u5F0F\u9519\u8BEF\uFF1AMarkdown \u5185\u5BB9\u4E3A\u7A7A`);
  const sections = Array.from(data.matchAll(/^###\s+(?:No\.\s*\d+:\s*)?(.+?)\s*$/gm));
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  sections.forEach((match, index) => {
    const title = cleanMarkdownText(match[1]);
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < sections.length ? sections[index + 1].index || data.length : data.length;
    const body = data.slice(start, end);
    const prompt = body.match(/####\s+[^\n]*(?:Prompt|提示词)[^\n]*\n\s*```[^\n]*\n([\s\S]*?)\n```/i)?.[1]?.trim() || "";
    if (!title || !prompt) return;
    const id = `${source.id}-${String(index + 1).padStart(4, "0")}`;
    if (seen.has(id)) return;
    seen.add(id);
    const descriptionSection = body.match(/####\s+[^\n]*(?:Description|描述)[^\n]*\n([\s\S]*?)(?=\n####|$)/i)?.[1] || "";
    const previewMedia = parseMarkdownPreviewMedia(body, source.url);
    const referenceImageUrls = previewMedia.filter((media) => media.kind === "image").map((media) => media.url);
    const coverUrl = referenceImageUrls[0] || "";
    items.push({
      id,
      title,
      prompt,
      description: cleanMarkdownText(descriptionSection).slice(0, 800),
      coverUrl,
      referenceImageUrls,
      previewMedia,
      tags: ["Seedance 2.0", "\u89C6\u9891"],
      preview: prompt.slice(0, 220),
      createdAt: "",
      updatedAt: "",
      sourceUrl: source.homepage
    });
  });
  return items;
}
function parseMarkdownPreviewMedia(body, sourceUrl) {
  const media = [];
  const addMedia = (kind, value) => {
    const absolute = absoluteUrl(sourceUrl, decodeHtmlEntities(value.trim()));
    if (!absolute || kind === "image" && !isPreviewImageUrl(absolute) || kind === "video" && !isVideoUrl(absolute)) return;
    const url = kind === "image" ? toPromptImageUrl(absolute) : absolute;
    if (!media.some((item) => item.kind === kind && item.url === url)) media.push({ kind, url });
  };
  for (const anchor of body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    addMedia("video", anchor[1]);
    for (const image of anchor[2].matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) addMedia("image", image[1]);
  }
  for (const image of body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) addMedia("image", image[1]);
  for (const image of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) addMedia("image", image[1]);
  for (const link of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) addMedia("video", link[1]);
  return media;
}
function isPreviewImageUrl(value) {
  return /thumbnail|\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(value) && !/img\.shields\.io\//i.test(value);
}
function isVideoUrl(value) {
  return /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
}
function decodeHtmlEntities(value) {
  return value.replace(/&amp;/g, "&");
}
function cleanMarkdownText(value) {
  return value.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim();
}
function parseJsonSource(data, source) {
  if (!Array.isArray(data)) throw new Error(`\u300C${source.name}\u300D\u683C\u5F0F\u9519\u8BEF\uFF1A\u6839\u8282\u70B9\u5FC5\u987B\u662F\u6570\u7EC4`);
  return normalizeItems(data, source);
}
function normalizeItems(values, source) {
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  values.forEach((value, index) => {
    const record = asRecord(value);
    const title = stringValue(record.title).trim();
    const prompt = stringValue(record.prompt).trim();
    if (!title || !prompt) return;
    const id = stringValue(record.id).trim() || `${source.id}-${leftPad(index + 1)}`;
    if (seen.has(id)) return;
    seen.add(id);
    const referenceImageUrls = stringArray(record.referenceImageUrls).map((url) => toPromptImageUrl(absoluteUrl(source.url, url)));
    const coverUrl = toPromptImageUrl(absoluteUrl(source.url, stringValue(record.coverUrl))) || referenceImageUrls[0] || "";
    const previewMedia = normalizePreviewMedia(record.previewMedia, source.url);
    if (!previewMedia.some((media) => media.kind === "image" && media.url === coverUrl) && coverUrl) previewMedia.push({ kind: "image", url: coverUrl });
    for (const url of referenceImageUrls) {
      if (!previewMedia.some((media) => media.kind === "image" && media.url === url)) previewMedia.push({ kind: "image", url });
    }
    items.push({
      id,
      title,
      prompt,
      description: stringValue(record.description),
      coverUrl,
      referenceImageUrls,
      previewMedia,
      tags: stringArray(record.tags),
      preview: stringValue(record.preview),
      createdAt: stringValue(record.createdAt),
      updatedAt: stringValue(record.updatedAt),
      author: stringValue(record.author),
      sourceUrl: absoluteUrl(source.url, stringValue(record.sourceUrl)),
      imageMode: optionalString(record.imageMode),
      imageModel: optionalString(record.imageModel),
      imageSize: optionalString(record.imageSize),
      imageCount: optionalNumber(record.imageCount)
    });
  });
  return items;
}
function normalizePreviewMedia(value, sourceUrl) {
  if (!Array.isArray(value)) return [];
  const media = [];
  for (const item of value) {
    const record = asRecord(item);
    const kind = stringValue(record.kind).toLowerCase();
    const url = stringValue(record.url).trim();
    if (kind !== "image" && kind !== "video" || !url) continue;
    const absolute = absoluteUrl(sourceUrl, url);
    const normalized = kind === "image" ? toPromptImageUrl(absolute) : absolute;
    if (!media.some((entry) => entry.kind === kind && entry.url === normalized)) media.push({ kind, url: normalized });
  }
  return media;
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function stringValue(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function stringArray(value) {
  return Array.isArray(value) ? value.map(stringValue).map((item) => item.trim()).filter(Boolean) : [];
}
function optionalString(value) {
  const result = stringValue(value).trim();
  return result || void 0;
}
function optionalNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : void 0;
}
function absoluteUrl(baseUrl, path) {
  if (!path) return "";
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}
function leftPad(value) {
  return String(value).padStart(4, "0");
}

// fg-studio-production-pilot/reference/infinite-canvas/src/services/api/prompt-source-presets.ts
var PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";
var DEFAULT_PROMPT_SOURCES = [
  registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "https://glidea.github.io/banana-prompt-quicker/"),
  registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2", "https://github.com/freestylefly/awesome-gpt-image-2"),
  registrySource("awesome-gpt-image", "Awesome GPT Image", "https://github.com/ZeroLu/awesome-gpt-image"),
  registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"),
  registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"),
  markdownSource("youmind-seedance-2-prompts", "YouMind Seedance 2.0 \u63D0\u793A\u8BCD", "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-seedance-2-prompts/main/README.md", "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts")
];
function registrySource(id, name, homepage) {
  return { id, name, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage, enabled: true, builtIn: true };
}
function markdownSource(id, name, url, homepage) {
  return { id, name, url, homepage, enabled: true, builtIn: true, format: "markdown" };
}
export {
  DEFAULT_PROMPT_SOURCES,
  parseJsonSource,
  parseMarkdownSource,
  promptImageOriginalUrl
};
