// Upstream catalogs sometimes publish same-repository thumbnails as absolute GitHub URLs.
// Serve those bundled files from this workspace rather than depending on external networking.
export function bundledInspirationCover(value: string, base = "/") {
    const prefix = "https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/web/public";
    const path = value.startsWith(prefix + "/inspiration-thumbs/") ? value.slice(prefix.length) : value;
    if (/^\/inspiration-thumbs\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g|avif)$/.test(path) && !path.includes("..")) {
        return base.replace(/\/+$/, "") + path;
    }
    return value;
}
