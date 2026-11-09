// 构建时显式选择 native，默认保留平台登录；Native auth is opt-in at build time, platform remains the default.
export const isNativeAuth = import.meta.env.VITE_FG_AUTH_MODE === "native";

export function fgWorkspaceBasePath(pathname: string) {
    return /^\/fg-six(?:\/|$)/.test(pathname) ? "/fg-six" : "";
}

export function fgSafeAuthNext(value: string | null, pathname = typeof window === "undefined" ? "" : window.location.pathname) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    try {
        // 拒绝浏览器可解释为跨站地址的分隔符；Reject ambiguous URL separators before normalization.
        const decoded = decodeURIComponent(value);
        if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return "/";
        const base = fgWorkspaceBasePath(pathname);
        const prefixed = Boolean(base && (value === base || value.startsWith(`${base}/`) || value.startsWith(`${base}?`) || value.startsWith(`${base}#`)));
        const url = new URL(value, "https://canvas.invalid");
        if (url.origin !== "https://canvas.invalid") return "/";
        if (prefixed && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return "/";
        const path = prefixed ? url.pathname.slice(base.length) || "/" : url.pathname;
        if (path.startsWith("//") || /^\/(?:login|register|forgot-password)(?:\/|$)/.test(path)) return "/";
        return `${path}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}

export function fgAuthReturnPath(next: string | null, pathname = typeof window === "undefined" ? "" : window.location.pathname) {
    return `${fgWorkspaceBasePath(pathname)}${fgSafeAuthNext(next, pathname)}`;
}

export function fgLoginPath(next: string) {
    return `/login?next=${encodeURIComponent(fgAuthReturnPath(next))}`;
}

export function fgStaticAssetURL(path: string, baseURL: string) {
    if (!path.startsWith("/") || path.startsWith("//")) return path;
    const base = baseURL.replace(/\/+$/, "");
    if (!base || path === base || path.startsWith(`${base}/`)) return path;
    return `${base}${path}`;
}

export function fgCanvasShareURL(origin: string, pathname: string, token: string) {
    return new URL(`${fgWorkspaceBasePath(pathname)}/share/canvas/${encodeURIComponent(token)}`, origin).href;
}

export function fgResourceAccessURL(url: string, apiBaseURL: string) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return url;
    const base = apiBaseURL.trim();
    if (base === "/fg-six/api" && url.startsWith("/api/")) return `/fg-six${url}`;
    if (!/^https?:\/\//i.test(base)) return url;
    return new URL(url, `${base.replace(/\/+$/, "")}/`).toString();
}

export function fgPlatformURL(origin: string, path = "/workspace") {
    if (isNativeAuth) {
        const pathname = typeof window === "undefined" ? "" : window.location.pathname;
        const base = fgWorkspaceBasePath(pathname);
        const next = typeof window === "undefined" ? "/" : `${pathname}${window.location.search}${window.location.hash}`;
        return new URL(`${base}${path === "/workspace" ? "/" : path === "/login" ? fgLoginPath(next) : fgSafeAuthNext(path)}`, origin).href;
    }
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
