import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { localStorage } from "@/lib/local/storage";
import { canAccessStoragePath } from "@/lib/local/storage-auth";

const allowedBuckets = new Set(["project-assets", "creator-assets"]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const form = await request.formData();
  const bucket = String(form.get("bucket") || "");
  const name = String(form.get("path") || "");
  const file = form.get("file");
  if (!bucket || !name || !(file instanceof File)) return NextResponse.json({ error: "媒体上传参数不完整" }, { status: 400 });
  if (!allowedBuckets.has(bucket)) return NextResponse.json({ error: "不支持的媒体存储空间" }, { status: 400 });
  if (!await canAccessStoragePath(user.id, bucket, name)) return NextResponse.json({ error: "无权访问该媒体路径" }, { status: 403 });
  const result = await localStorage(bucket).upload(name, file, { upsert: form.get("upsert") === "true", contentType: file.type });
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await request.json();
  const bucket = String(body.bucket || "");
  if (!allowedBuckets.has(bucket)) return NextResponse.json({ error: "不支持的媒体存储空间" }, { status: 400 });
  const paths: string[] = Array.isArray(body.paths) ? body.paths.filter((name: unknown): name is string => typeof name === "string") : [];
  const access = await Promise.all(paths.map((name) => canAccessStoragePath(user.id, bucket, name)));
  if (access.some((allowed) => !allowed)) return NextResponse.json({ error: "无权访问该媒体路径" }, { status: 403 });
  const result = await localStorage(bucket).remove(paths);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
