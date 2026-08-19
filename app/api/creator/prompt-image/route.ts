import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/local/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PRIVATE_HOSTNAME = /(^|\.)(localhost|local|internal)$/i;

export async function GET(request: NextRequest) {
    const localClient = createClient();
    const { data: { user } } = await localClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

    const rawUrl = request.nextUrl.searchParams.get("url")?.trim() || "";
    const target = parsePublicImageUrl(rawUrl);
    if (!target) return NextResponse.json({ error: "invalid image url" }, { status: 400 });

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
        if (!response.ok) return NextResponse.json({ error: "remote image returned " + response.status }, { status: 502 });

        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
        if (!contentType.startsWith("image/")) return NextResponse.json({ error: "remote resource is not an image" }, { status: 415 });

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "image exceeds 12 MB" }, { status: 413 });

        const body = await response.arrayBuffer();
        if (body.byteLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "image exceeds 12 MB" }, { status: 413 });

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
