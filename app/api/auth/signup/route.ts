import { NextResponse } from "next/server";
import { createAccount } from "@/lib/local/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email.endsWith("@beva.com")) return NextResponse.json({ error: "仅支持 @beva.com 邮箱" }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
    const user = await createAccount(email, password);
    return NextResponse.json({ data: { user }, error: null }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "注册失败" }, { status: 400 });
  }
}
