import type { PromptSource } from "./prompt-source-presets";
import { toPromptImageUrl } from "./prompt-image-url";

export type PromptPreviewMedia = {
    kind: "image" | "video";
    url: string;
};

export type RawPrompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl: string;
    referenceImageUrls: string[];
    previewMedia: PromptPreviewMedia[];
    tags: string[];
    preview: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    sourceUrl?: string;
    imageMode?: string;
    imageModel?: string;
    imageSize?: string;
    imageCount?: number;
};

type RunOptions = { signal?: AbortSignal };

async function fetchSource(source: PromptSource, options?: RunOptions) {
    const response = await fetch(source.url, { cache: "no-store", signal: options?.signal });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return source.format === "markdown" ? response.text() : response.json();
}

export async function runPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {
    if (!source.url.trim()) throw new Error("提示词来源 URL 不能为空");
    let data: unknown;
    try {
        data = await fetchSource(source, options);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(`「${source.name}」拉取失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const items = source.format === "markdown" ? parseMarkdownSource(data, source) : parseJsonSource(data, source);
    if (source.builtIn && !items.length) throw new Error(`「${source.name}」未解析到有效提示词`);
    console.info("[prompt source parsed]", {
        sourceId: source.id,
        format: source.format || "json",
        count: items.length,
        imagePreviewCount: items.filter((item) => item.previewMedia.some((media) => media.kind === "image")).length,
        videoPreviewCount: items.filter((item) => item.previewMedia.some((media) => media.kind === "video")).length,
    });
    return items;
}

/**
 * The YouMind Seedance collection is published as a Markdown catalogue, not
 * our JSON registry format.  Parse its numbered prompt sections locally so
 * the source remains inspectable and does not depend on an unofficial mirror.
 */
export function parseMarkdownSource(data: unknown, source: PromptSource) {
    if (typeof data !== "string") throw new Error(`「${source.name}」格式错误：Markdown 内容为空`);
    const sections = Array.from(data.matchAll(/^###\s+(?:No\.\s*\d+:\s*)?(.+?)\s*$/gm));
    const items: RawPrompt[] = [];
    const seen = new Set<string>();
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
            tags: ["Seedance 2.0", "视频"],
            preview: prompt.slice(0, 220),
            createdAt: "",
            updatedAt: "",
            sourceUrl: source.homepage,
        });
    });
    return items;
}

function parseMarkdownPreviewMedia(body: string, sourceUrl: string): PromptPreviewMedia[] {
    const media: PromptPreviewMedia[] = [];
    const addMedia = (kind: PromptPreviewMedia["kind"], value: string) => {
        const absolute = absoluteUrl(sourceUrl, decodeHtmlEntities(value.trim()));
        if (!absolute || (kind === "image" && !isPreviewImageUrl(absolute)) || (kind === "video" && !isVideoUrl(absolute))) return;
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

function isPreviewImageUrl(value: string) {
    return /thumbnail|\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(value) && !/img\.shields\.io\//i.test(value);
}

function isVideoUrl(value: string) {
    return /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
}

function decodeHtmlEntities(value: string) {
    return value.replace(/&amp;/g, "&");
}

function cleanMarkdownText(value: string) {
    return value
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[`*_>#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function parseJsonSource(data: unknown, source: PromptSource) {
    if (!Array.isArray(data)) throw new Error(`「${source.name}」格式错误：根节点必须是数组`);
    return normalizeItems(data, source);
}

function normalizeItems(values: unknown[], source: PromptSource) {
    const seen = new Set<string>();
    const items: RawPrompt[] = [];
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
            imageCount: optionalNumber(record.imageCount),
        });
    });
    return items;
}

function normalizePreviewMedia(value: unknown, sourceUrl: string): PromptPreviewMedia[] {
    if (!Array.isArray(value)) return [];
    const media: PromptPreviewMedia[] = [];
    for (const item of value) {
        const record = asRecord(item);
        const kind = stringValue(record.kind).toLowerCase();
        const url = stringValue(record.url).trim();
        if ((kind !== "image" && kind !== "video") || !url) continue;
        const absolute = absoluteUrl(sourceUrl, url);
        const normalized = kind === "image" ? toPromptImageUrl(absolute) : absolute;
        if (!media.some((entry) => entry.kind === kind && entry.url === normalized)) media.push({ kind, url: normalized });
    }
    return media;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).map((item) => item.trim()).filter(Boolean) : [];
}

function optionalString(value: unknown) {
    const result = stringValue(value).trim();
    return result || undefined;
}

function optionalNumber(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : undefined;
}

function absoluteUrl(baseUrl: string, path: string) {
    if (!path) return "";
    try {
        return new URL(path, baseUrl).toString();
    } catch {
        return path;
    }
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}
