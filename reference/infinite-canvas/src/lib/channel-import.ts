import { createModelChannel, type ModelChannel } from "@/reference/infinite-canvas/src/stores/use-config-store";

/** Only accept an absolute HTTP(S) endpoint from a configuration-import URL. */
export function normalizeImportedBaseUrl(value: string | null | undefined) {
    if (!value?.trim()) return null;
    try {
        const url = new URL(value.trim());
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
        url.hash = "";
        url.search = "";
        return url.toString().replace(/\/$/, "");
    } catch {
        return null;
    }
}

/**
 * Configuration links must never silently mutate an arbitrary first channel.
 * A matching endpoint is updated in place; a new endpoint receives its own
 * channel so existing team or personal routes remain untouched.
 */
export function mergeImportedChannel(channels: ModelChannel[], baseUrl: string, apiKey?: string | null) {
    const normalizedBaseUrl = normalizeImportedBaseUrl(baseUrl);
    if (!normalizedBaseUrl) return null;
    const existingIndex = channels.findIndex((channel) => normalizeImportedBaseUrl(channel.baseUrl) === normalizedBaseUrl);
    const existing = existingIndex >= 0 ? channels[existingIndex] : undefined;
    const imported = createModelChannel({
        ...existing,
        name: existing?.name || `导入渠道 · ${new URL(normalizedBaseUrl).host}`,
        baseUrl: normalizedBaseUrl,
        apiKey: apiKey || existing?.apiKey || "",
    });
    return existingIndex >= 0
        ? channels.map((channel, index) => (index === existingIndex ? imported : channel))
        : [...channels, imported];
}
