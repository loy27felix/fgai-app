import { NextResponse } from "next/server";
import { clearSession } from "@/lib/local/auth";

export async function POST() {
  await clearSession();
  return NextResponse.json({ error: null });
}
