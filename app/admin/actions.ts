"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addWhitelist(email: string) {
  const sb = createClient();
  const { error } = await sb.from("whitelist").insert({ email: email.trim().toLowerCase(), status: "approved" });
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function setWhitelistStatus(id: string, status: "approved" | "pending" | "rejected") {
  const sb = createClient();
  const { error } = await sb.from("whitelist").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function deleteWhitelist(id: string) {
  const sb = createClient();
  const { error } = await sb.from("whitelist").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function setUserRole(userId: string, role: "user" | "admin" | "superadmin") {
  const sb = createClient();
  const { error } = await sb.from("profiles").update({ platform_role: role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
