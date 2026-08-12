"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUsdToCnyRate } from "@/lib/usage/fx";

async function requireAdmin() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "请先登录" as const };
  const { data: me } = await sb.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  if (me?.platform_role !== "admin" && me?.platform_role !== "superadmin") return { error: "无权执行管理操作" as const };
  return { sb, userId: user.id, role: me.platform_role };
}

export async function addWhitelist(email: string) {
  const access = await requireAdmin();
  if ("error" in access) return access;
  const { sb } = access;
  const { error } = await sb.from("whitelist").insert({ email: email.trim().toLowerCase(), status: "approved" });
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function setWhitelistStatus(id: string, status: "approved" | "pending" | "rejected") {
  const access = await requireAdmin();
  if ("error" in access) return access;
  const { sb } = access;
  const { error } = await sb.from("whitelist").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function deleteWhitelist(id: string) {
  const access = await requireAdmin();
  if ("error" in access) return access;
  const { sb } = access;
  const { error } = await sb.from("whitelist").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}
export async function setUserRole(userId: string, role: "user" | "admin" | "superadmin") {
  const access = await requireAdmin();
  if ("error" in access) return access;
  const { sb } = access;
  if (userId === access.userId) return { error: "不能修改自己的角色" };
  const { data: target } = await sb.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
  if (!target) return { error: "用户不存在" };
  if (access.role !== "superadmin" && (role === "superadmin" || target.platform_role === "superadmin")) return { error: "只有超级管理员可以修改超级管理员角色" };
  const { error } = await sb.from("profiles").update({ platform_role: role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin"); return { ok: true };
}

export async function setMonthlyBudget(userId: string, monthStart: string, limitCny: string) {
  const access = await requireAdmin();
  if ("error" in access) return access;
  const { sb } = access;
  if (!/^\d{4}-\d{2}-01$/.test(monthStart)) return { error: "月份格式无效" };
  if (!userId) return { error: "用户无效" };
  if (!limitCny.trim()) {
    const { error } = await sb.from("ai_usage_budgets").delete().eq("user_id", userId).eq("month_start", monthStart);
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true, removed: true };
  }
  const cny = Number(limitCny);
  if (!Number.isFinite(cny) || cny < 0 || cny > 1_000_000_000) return { error: "额度必须是 0 到 10 亿元之间的数字" };
  const limitUsd = Number((cny / getUsdToCnyRate()).toFixed(10));
  const { error } = await sb.from("ai_usage_budgets").upsert({ user_id: userId, month_start: monthStart, limit_usd: limitUsd }, { onConflict: "user_id,month_start" });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true, limitUsd };
}
