import { NextResponse } from "next/server";
import { signIn } from "@/lib/local/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const user = await signIn(String(body.email || ""), String(body.password || ""));
    return NextResponse.json({ data: { user }, error: null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 401 });
  }
}
