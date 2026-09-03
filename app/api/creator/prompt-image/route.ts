import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/local/server";
import { logServerEvent } from "@/lib/observability/server-log";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PRIVATE_HOSTNAME = /(^|\.)(localhost|local|internal)$/i;

export async function GET(request: NextRequest) {
    const localClient = createClient();
    const { data: { user } } = await localClient.auth.getUser();
    if (!user) {
        logServerEvent("prompt_image_proxy_unauthenticated", {}, "warn");
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const rawUrl = request.nextUrl.searchParams.get("url")?.trim() || "";
    const target = parsePublicImageUrl(rawUrl);
    if (!target) {
        logServerEvent("prompt_image_proxy_rejected_target", {}, "warn");
        return NextResponse.json({ error: "invalid image url" }, { status: 400 });
    }

    try {
        const response = await fetch(target, {
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
            headers: {
                Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                Referer: target.origin + "/",
                "User-Agent": "FG-Studio prompt image proxy",
            },
        });
        if (!response.ok) {
            logServerEvent("prompt_image_proxy_remote_error", { host: target.hostname, status: response.status }, "warn");
            return NextResponse.json({ error: "remote image returned " + response.status }, { status: 502 });
        }

        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
        if (!contentType.startsWith("image/")) {
            logServerEvent("prompt_image_proxy_invalid_content_type", { host: target.hostname, contentType }, "warn");
            return NextResponse.json({ error: "remote resource is not an image" }, { status: 415 });
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
            logServerEvent("prompt_image_proxy_too_large", { host: target.hostname, contentLength }, "warn");
            return NextResponse.json({ error: "image exceeds 12 MB" }, { status: 413 });
        }

        const body = await response.arrayBuffer();
        if (body.byteLength > MAX_IMAGE_BYTES) {
            logServerEvent("prompt_image_proxy_too_large_after_download", { host: target.hostname, bytes: body.byteLength }, "warn");
            return NextResponse.json({ error: "image exceeds 12 MB" }, { status: 413 });
        }

        return new NextResponse(body, {
            headers: {
                "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
                "Content-Length": String(body.byteLength),
                "Content-Type": contentType,
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logServerEvent("prompt_image_proxy_fetch_failed", { host: target.hostname, message }, "warn");
        return NextResponse.json({ error: "image proxy failed: " + message }, { status: 502 });
    }
}

function parsePublicImageUrl(value: string) {
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.port || PRIVATE_HOSTNAME.test(normalizedHostname) || isPrivateIp(normalizedHostname)) return null;
        return url;
    } catch {
        return null;
    }
}

function isPrivateIp(hostname: string) {
    if (hostname === "::" || hostname === "::1" || /^fc|^fd|^fe80:/i.test(hostname)) return true;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(hostname)) return true;
    const match = hostname.match(/^172\.(\d{1,3})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
