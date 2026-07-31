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
