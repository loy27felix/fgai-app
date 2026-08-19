import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { localFileSize, readLocalFile, readLocalRange, verifyLocalSignedUrl } from "@/lib/local/storage";
import { canAccessStoragePath } from "@/lib/local/storage-auth";

const allowedBuckets = new Set(["project-assets", "creator-assets"]);

function contentType(name: string) {
  const extension = name.toLowerCase().split(".").pop();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf" } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") || "";
  const name = url.searchParams.get("path") || "";
  const range = request.headers.get("range");
  const cfRay = request.headers.get("cf-ray");
  // Log only the path and auth outcome; never log signed tokens or cookies.
  // 只记录路径和鉴权结果，禁止记录 signed token 或 Cookie。
  console.info("[local media request]", {
    bucket,
    path: name,
    hasRange: Boolean(range),
    cfRay: cfRay || undefined,
  });
  if (!allowedBuckets.has(bucket) || !name) {
    console.warn("[local media rejected]", { bucket, path: name, reason: "invalid_path", cfRay: cfRay || undefined });
    return new NextResponse("媒体路径无效", { status: 400 });
  }
  const signedAccess = verifyLocalSignedUrl(bucket, name, url.searchParams.get("expires"), url.searchParams.get("token"));
  console.info("[local media auth]", {
    bucket,
    path: name,
    signedAccess,
    authenticated: Boolean(user),
    cfRay: cfRay || undefined,
  });
  if (!user && !signedAccess) return new NextResponse("未登录", { status: 401 });
  if (user && !signedAccess && !await canAccessStoragePath(user.id, bucket, name)) return new NextResponse("无权访问该媒体路径", { status: 403 });
  try {
    const size = await localFileSize(bucket, name);
    const headers = { "Accept-Ranges": "bytes", "Content-Type": contentType(name), "Cache-Control": "private, max-age=300" };
    console.info("[local media file]", {
      bucket,
      path: name,
      size,
      hasRange: Boolean(range),
      cfRay: cfRay || undefined,
    });
    if (!range) return new NextResponse(await readLocalFile(bucket, name), { headers: { ...headers, "Content-Length": String(size) } });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new NextResponse("Range 不支持", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
    const end = match[2] ? Math.min(size - 1, Number(match[2])) : Math.min(size - 1, start + 1024 * 1024 - 1);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return new NextResponse("Range 超出文件范围", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = await readLocalRange(bucket, name, start, end);
    return new NextResponse(body, { status: 206, headers: { ...headers, "Content-Length": String(body.length), "Content-Range": `bytes ${start}-${end}/${size}` } });
  } catch (error) {
    console.error("[local media failure]", {
      bucket,
      path: name,
      message: error instanceof Error ? error.message : String(error),
      cfRay: cfRay || undefined,
    });
    return new NextResponse("媒体文件不存在", { status: 404 });
  }
}
