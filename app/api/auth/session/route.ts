import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ data: { session: user ? { user } : null }, error: null });
}
