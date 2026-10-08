export function fgWorkspaceBasePath(pathname: string) {
    return /^\/fg-six(?:\/|$)/.test(pathname) ? "/fg-six" : "";
}

export function fgResourceAccessURL(url: string, apiBaseURL: string) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return url;
    const base = apiBaseURL.trim();
    if (base === "/fg-six/api" && url.startsWith("/api/")) return `/fg-six${url}`;
    if (!/^https?:\/\//i.test(base)) return url;
    return new URL(url, `${base.replace(/\/+$/, "")}/`).toString();
}

export function fgPlatformURL(origin: string, path = "/workspace") {
    const url = new URL(origin);
    if (url.hostname === "192.168.0.99" && ["3016", "3017"].includes(url.port)) url.port = "3000";
    return new URL(path, url.origin).href;
}

export function fgDirectorURL(origin: string, pathname: string) {
    const url = new URL(origin);
    if (!fgWorkspaceBasePath(pathname) && url.hostname === "192.168.0.99" && url.port === "3016") {
        url.port = "3017";
        return url.href;
    }
    return new URL("/fg-director/", origin).href;
}
