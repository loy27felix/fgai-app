export const PROMPT_IMAGE_PROXY_PATH = "/api/creator/prompt-image?url=";

export function toPromptImageUrl(value: string) {
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

/**
 * Return the public source URL embedded in a same-origin prompt-image proxy
 * URL.  This is deliberately only used after the proxy has failed in the
 * browser; the proxy remains the primary path so private-network protection
 * and authentication checks are not bypassed by default.
 */
export function promptImageOriginalUrl(value: string) {
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

export function normalizeGitHubImageUrl(input: URL) {
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
