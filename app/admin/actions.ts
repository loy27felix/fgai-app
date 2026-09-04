"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/local/server";
import { createAdminClient } from "@/lib/local/admin";
import { isMonthStartKey } from "@/lib/usage/budget";
import { getUsdToCnyRate } from "@/lib/usage/fx";
import { recordAuditEvent } from "@/lib/observability/audit-event";
import { logServerEvent, logServerFailure } from "@/lib/observability/server-log";

type AdminAccess = {
  sb: ReturnType<typeof createClient>;
  userId: string;
  role: string;
};

type AdminAccessResult = AdminAccess | { error: string };

function currentTraceId() {
  try {
    const requestHeaders = headers();
    return requestHeaders.get("x-fg-trace-id") || requestHeaders.get("x-request-id") || null;
  } catch {
    return null;
  }
}

function resultError(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" && value.error ? value.error : null;
}

function auditAdminAction(
  access: AdminAccess,
  action: string,
  resourceType: string,
  resourceId: string | null,
  stage: string,
  outcome: "succeeded" | "failed" | "rejected",
  parameters: Record<string, unknown>,
  error?: unknown,
) {
  void recordAuditEvent({
    traceId: currentTraceId(),
    actorId: access.userId,
    feature: "admin",
    action,
    resourceType,
    resourceId,
    stage,
    outcome,
    parameters,
    error,
    level: outcome === "failed" ? "error" : undefined,
  });
}

async function runAdminAction<T>(
  action: string,
  resourceType: string,
  resourceId: string | null,
  parameters: Record<string, unknown>,
  execute: (access: AdminAccess) => Promise<T>,
) {
  const traceId = currentTraceId();
  let access: AdminAccessResult;
  try {
    access = await requireAdmin();
  } catch (error) {
    logServerFailure("admin_action_auth_failed", error, { traceId, feature: "admin", action, resourceType, resourceId, stage: "authorization" });
    return { error: "管理操作失败，请稍后重试" };
  }
  if ("error" in access) {
    logServerEvent("admin_action_rejected", { traceId, feature: "admin", action, resourceType, resourceId, stage: "authorization", reason: access.error }, "warn");
    return access;
  }

  const startedAt = Date.now();
  logServerEvent("admin_action_started", { traceId, feature: "admin", action, resourceType, resourceId, actorId: access.userId, stage: "started" });
  try {
    const result = await execute(access);
    const errorMessage = resultError(result);
    if (errorMessage) {
      logServerEvent("admin_action_rejected", { traceId, feature: "admin", action, resourceType, resourceId, actorId: access.userId, stage: "rejected", reason: errorMessage, durationMs: Date.now() - startedAt }, "warn");
      auditAdminAction(access, action, resourceType, resourceId, "rejected", "rejected", parameters, new Error(errorMessage));
      return result;
    }
    logServerEvent("admin_action_completed", { traceId, feature: "admin", action, resourceType, resourceId, actorId: access.userId, stage: "completed", outcome: "succeeded", durationMs: Date.now() - startedAt });
    auditAdminAction(access, action, resourceType, resourceId, "completed", "succeeded", parameters);
    return result;
  } catch (error) {
    logServerFailure("admin_action_failed", error, { traceId, feature: "admin", action, resourceType, resourceId, actorId: access.userId, stage: "failed", durationMs: Date.now() - startedAt });
    auditAdminAction(access, action, resourceType, resourceId, "failed", "failed", parameters, error);
    return { error: "操作失败，请稍后重试" };
  }
}

async function requireAdmin(): Promise<AdminAccessResult> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "请先登录" as const };
  const { data: me, error: profileError } = await sb.from("profiles").select("platform_role").eq("id", user.id).maybeSingle();
  if (profileError) return { error: "管理员身份读取失败" };
  if (me?.platform_role !== "admin" && me?.platform_role !== "superadmin") return { error: "无权执行管理操作" as const };
  return { sb, userId: user.id, role: me.platform_role };
}

export async function addWhitelist(email: string) {
  return runAdminAction("whitelist_add", "whitelist", null, { status: "approved" }, async ({ sb }) => {
    const { error } = await sb.from("whitelist").insert({ email: email.trim().toLowerCase(), status: "approved" });
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  });
}
export async function setWhitelistStatus(id: string, status: "approved" | "pending" | "rejected") {
  return runAdminAction("whitelist_status", "whitelist", id, { status }, async ({ sb }) => {
    const { error } = await sb.from("whitelist").update({ status }).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  });
}
export async function deleteWhitelist(id: string) {
  return runAdminAction("whitelist_delete", "whitelist", id, {}, async ({ sb }) => {
    const { error } = await sb.from("whitelist").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  });
}
export async function setUserRole(userId: string, role: "user" | "admin" | "superadmin") {
  return runAdminAction("user_role_update", "profile", userId, { role }, async (access) => {
    const { sb } = access;
    if (userId === access.userId) return { error: "不能修改自己的角色" };
    if (role !== "user" && role !== "admin" && role !== "superadmin") return { error: "角色无效" };
    const { data: target, error: targetError } = await sb.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
    if (targetError) return { error: targetError.message };
    if (!target) return { error: "用户不存在" };
    if (access.role !== "superadmin" && (role === "superadmin" || target.platform_role === "superadmin")) return { error: "只有超级管理员可以修改超级管理员角色" };
    const { error } = await sb.from("profiles").update({ platform_role: role }).eq("id", userId);
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  });
}

export async function setMonthlyBudget(userId: string, monthStart: string, limitCny: string) {
  return runAdminAction("monthly_budget_set", "monthly_budget", userId, { monthStart, limitCny }, async ({ sb }) => {
    if (!isMonthStartKey(monthStart)) return { error: "月份格式无效" };
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
  });
}

/** Records a Wetoken amount that an administrator has matched to this ledger row. */
export async function reconcileUsageCost(ledgerId: string, reportedUsd: string) {
  return runAdminAction("usage_cost_reconcile", "ai_usage_ledger", ledgerId, { reportedUsd }, async (access) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ledgerId)) return { error: "账本记录 ID 无效" };
    const amount = Number(reportedUsd);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return { error: "实际费用必须是 0 到 10 亿美元之间的数字" };

    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin.from("ai_usage_ledger").select("id,price_snapshot").eq("id", ledgerId).maybeSingle();
    if (lookupError) return { error: lookupError.message };
    if (!existing) return { error: "未找到这条账本记录" };
    const existingSnapshot = existing.price_snapshot && typeof existing.price_snapshot === "object" && !Array.isArray(existing.price_snapshot)
      ? existing.price_snapshot as Record<string, unknown>
      : {};
    const { error } = await admin.from("ai_usage_ledger").update({
      reported_cost_usd: Number(amount.toFixed(10)),
      cost_source: "reported",
      price_snapshot: { ...existingSnapshot, reconciliation_source: "manual_wetoken_billing", reconciled_at: new Date().toISOString(), reconciled_by: access.userId },
    }).eq("id", ledgerId);
    if (error) return { error: error.message };
    revalidatePath("/admin");
    return { ok: true };
  });
}
