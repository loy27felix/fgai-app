import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/local/admin";
import { labActor } from "@/lib/production-lab/access";
import { hasSameOriginLabRequest } from "@/lib/production-lab/origin";
import { addCostLine, emptyCostBuckets, groupAtTime, type CostBuckets, type MembershipInterval } from "@/lib/production-lab/admin-accounting";
import { resolveLabMediaAccounting } from "@/lib/production-lab/media-accounting";
import { database, readLab } from "@/lib/production-lab/store";
import { query as usageQuery } from "@/lib/local/db";
import { productionLabDisplayName } from "@/lib/production-lab/identities";
import { findUsageLedgerRows } from "@/lib/production-lab/media-runner";
import { PRODUCTION_LAB_AGENT_LEDGER_SOURCE } from "@/lib/production-lab/agent-accounting";
import { fxSnapshot, usdToCny } from "@/lib/usage/fx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GroupRow = { id: string; name: string; created_by: string; created_at: string; updated_at: string; archived_at: string | null };
type MembershipRow = { id: string; group_id: string; user_id: string; group_name_snapshot: string; assigned_by: string; assigned_at: string; unassigned_by: string | null; unassigned_at: string | null };
type AdminEventRow = { id: string; actor_id: string; action: string; group_id: string | null; details: Record<string, unknown>; created_at: string };
type MediaRow = { id: string; owner_id: string; project_id: string; episode: number; kind: "image" | "video"; status: string; model: string; request_id: string; provider_request_id: string | null; estimated_cost_usd: string | number | null; reported_cost_usd: string | number | null; accounting_error: string | null; created_at: string };
type ScriptRow = { actor_id: string; request_id: string; model_id: string; project_id: string | null; status: string; result: unknown; reported_cost_usd: string | number | null; estimated_cost_usd: string | number | null; cost_source: string; provider_request_id: string | null; accounting_error: string | null; created_at: string };
type AgentLedgerRow = { request_id: string; provider_request_id: string | null; user_id: string; project_id: string | null; input_tokens: number | string | null; output_tokens: number | string | null; total_tokens: number | string | null; reported_cost_usd: number | string | null; estimated_cost_usd: number | string | null; cost_source: string; price_snapshot: Record<string, unknown> | null; status: string; created_at: string };
type ReportEntry = CostBuckets & { requests: number; imageJobs: number; videoJobs: number; scriptRuns: number; agentTurns: number; totalTokens: number };
type AccountRow = { id: string; email: string; created_at: string };

const emptyEntry = (): ReportEntry => ({ ...emptyCostBuckets(), requests: 0, imageJobs: 0, videoJobs: 0, scriptRuns: 0, agentTurns: 0, totalTokens: 0 });
const numeric = (value: unknown) => { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function requireSuperadmin() {
  const actor = await labActor();
  return actor?.reviewer ? actor : null;
}

async function directory() {
  const [groups, memberships, events, accountsResult, rolesResult] = await Promise.all([
    database().query<GroupRow>("SELECT id,name,created_by,created_at,updated_at,archived_at FROM production_lab_groups ORDER BY archived_at NULLS FIRST,created_at"),
    database().query<MembershipRow>("SELECT id,group_id,user_id,group_name_snapshot,assigned_by,assigned_at,unassigned_by,unassigned_at FROM production_lab_group_memberships ORDER BY assigned_at DESC LIMIT 10000"),
    database().query<AdminEventRow>("SELECT id,actor_id,action,group_id,details,created_at FROM production_lab_admin_events ORDER BY created_at DESC LIMIT 30"),
    createAdminClient().from("app_users").select("id,email,created_at").order("created_at", { ascending: true }),
    createAdminClient().from("profiles").select("id,platform_role"),
  ]);
  if (accountsResult.error || rolesResult.error) throw new Error("读取平台账号失败");
  const accounts = (accountsResult.data || []) as AccountRow[];
  const roleById = new Map(((rolesResult.data || []) as { id: string; platform_role: string | null }[]).map((row) => [row.id, row.platform_role || "user"]));
  const current = new Map(memberships.rows.filter((membership) => !membership.unassigned_at).map((membership) => [membership.user_id, membership]));
  const groupById = new Map(groups.rows.map((group) => [group.id, group]));
  const memberCounts = new Map<string, number>();
  for (const membership of current.values()) memberCounts.set(membership.group_id, (memberCounts.get(membership.group_id) || 0) + 1);
  const users = accounts.map((user) => {
    const membership = current.get(user.id);
    return {
      id: user.id, email: user.email,
      displayName: productionLabDisplayName(user.email),
      platformRole: roleById.get(user.id) || "user", createdAt: user.created_at,
      groupId: membership?.group_id || null,
      groupName: membership ? (groupById.get(membership.group_id)?.name || membership.group_name_snapshot) : null,
    };
  });
  return {
    groups: groups.rows.map((group) => ({ id: group.id, name: group.name, createdBy: group.created_by, createdAt: group.created_at, updatedAt: group.updated_at, archivedAt: group.archived_at, memberCount: memberCounts.get(group.id) || 0 })),
    users,
    membershipHistory: memberships.rows.map((membership) => ({ id: membership.id, groupId: membership.group_id, userId: membership.user_id, groupName: membership.group_name_snapshot, assignedBy: membership.assigned_by, assignedAt: membership.assigned_at, unassignedBy: membership.unassigned_by, unassignedAt: membership.unassigned_at })),
    events: events.rows,
  };
}

export async function GET(request: Request) {
  const actor = await requireSuperadmin();
  if (!actor) return NextResponse.json({ error: "仅超级管理员可管理第六板块" }, { status: 403 });
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("view") !== "report") return NextResponse.json(await directory());

    const [{ rows: mediaJobs }, { rows: mediaCount }, { rows: scriptRuns }, { rows: scriptCount }, { rows: membershipHistoryRows }, state, usersResult, rolesResult, groupsResult] = await Promise.all([
      database().query<MediaRow>("SELECT id,owner_id,project_id,episode,kind,status,model,request_id,provider_request_id,estimated_cost_usd,reported_cost_usd,accounting_error,created_at FROM production_lab_media_jobs ORDER BY created_at DESC LIMIT 10000"),
      database().query<{ count: string }>("SELECT count(*)::text AS count FROM production_lab_media_jobs"),
      database().query<ScriptRow>("SELECT actor_id,request_id,model_id,project_id,status,result,reported_cost_usd,estimated_cost_usd,cost_source,provider_request_id,accounting_error,created_at FROM production_lab_script_runs ORDER BY created_at DESC LIMIT 10000"),
      database().query<{ count: string }>("SELECT count(*)::text AS count FROM production_lab_script_runs"),
      database().query<MembershipRow>("SELECT id,group_id,user_id,group_name_snapshot,assigned_by,assigned_at,unassigned_by,unassigned_at FROM production_lab_group_memberships ORDER BY assigned_at DESC LIMIT 10000"),
      readLab(),
      createAdminClient().from("app_users").select("id,email,created_at"),
      createAdminClient().from("profiles").select("id,platform_role"),
      database().query<GroupRow>("SELECT id,name,created_by,created_at,updated_at,archived_at FROM production_lab_groups ORDER BY created_at"),
    ]);
    if (usersResult.error || rolesResult.error) throw new Error("读取平台账号失败");
    const productionProjectIds = state.projects.map(project => project.id);
    const [{ rows: agentLedgerRows }, { rows: agentCountRows }] = await Promise.all([
      usageQuery<AgentLedgerRow>("SELECT request_id,provider_request_id,user_id,project_id,input_tokens,output_tokens,total_tokens,reported_cost_usd,estimated_cost_usd,cost_source,price_snapshot,status,created_at FROM ai_usage_ledger WHERE project_id=ANY($2::uuid[]) AND price_snapshot->>'production_lab_source'=$1 ORDER BY created_at DESC LIMIT 10000", [PRODUCTION_LAB_AGENT_LEDGER_SOURCE, productionProjectIds]),
      usageQuery<{ count: string }>("SELECT count(*)::text AS count FROM ai_usage_ledger WHERE project_id=ANY($2::uuid[]) AND price_snapshot->>'production_lab_source'=$1", [PRODUCTION_LAB_AGENT_LEDGER_SOURCE, productionProjectIds]),
    ]);
    const agentLedgerTotal = Number(agentCountRows[0]?.count || 0);
    const users = (usersResult.data || []) as AccountRow[];
    const roles = ((rolesResult.data || []) as { id: string; platform_role: string | null }[]);
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    const nameById = new Map(users.map((user) => [user.id, productionLabDisplayName(user.email)]));
    const membershipHistory: MembershipInterval[] = membershipHistoryRows.map((membership) => ({ userId: membership.user_id, groupId: membership.group_id, groupName: membership.group_name_snapshot, assignedAt: membership.assigned_at, unassignedAt: membership.unassigned_at }));
    const ledgerByRequest = await findUsageLedgerRows([...mediaJobs.map((job) => job.request_id), ...scriptRuns.map((run) => run.request_id)]);
    const alreadyReportedRequestIds = new Set([...mediaJobs.map((job) => job.request_id), ...scriptRuns.map((run) => run.request_id)]);
    const people = new Map<string, { userId: string; email: string; name: string; platformRole: string; currentGroup: string | null } & ReportEntry>();
    const projects = new Map<string, { projectId: string; title: string; tier: string; stage: string; team: string; ownerId: string; ownerName: string; ownerEmail: string; budgetCny: number } & ReportEntry>();
    const groups = new Map<string, { groupId: string; name: string; memberCount: number } & ReportEntry>();
    const allGroups = groupsResult.rows;
    const currentMemberships = new Map(membershipHistoryRows.filter((row) => !row.unassigned_at).map((row) => [row.user_id, row]));
    for (const group of allGroups) groups.set(group.id, { groupId: group.id, name: group.name, memberCount: 0, ...emptyEntry() });
    for (const membership of currentMemberships.values()) {
      const group = groups.get(membership.group_id);
      if (group) group.memberCount += 1;
    }
    for (const user of users) {
      const membership = currentMemberships.get(user.id);
      people.set(user.id, { userId: user.id, email: user.email, name: productionLabDisplayName(user.email), platformRole: roles.find((role) => role.id === user.id)?.platform_role || "user", currentGroup: membership ? (allGroups.find((group) => group.id === membership.group_id)?.name || membership.group_name_snapshot) : null, ...emptyEntry() });
    }
    for (const project of state.projects) projects.set(project.id, { projectId: project.id, title: project.title, tier: project.tier, stage: project.stage, team: project.team, ownerId: project.ownerId, ownerName: nameById.get(project.ownerId) || project.ownerName, ownerEmail: emailById.get(project.ownerId) || "", budgetCny: project.budgetCny, ...emptyEntry() });
    const unassignedKey = "__unassigned__";
    groups.set(unassignedKey, { groupId: unassignedKey, name: "未归属小组", memberCount: 0, ...emptyEntry() });
    const total = emptyEntry();

    const applyRequest = (userId: string, projectId: string | null, createdAt: string, line: { settledUsd?: unknown; reportedUsd?: unknown; estimatedUsd?: unknown }, kind: "image" | "video" | "script" | "agent", tokens = 0) => {
      if (!people.has(userId)) people.set(userId, { userId, email: emailById.get(userId) || "平台账号已不存在", name: nameById.get(userId) || "未知账号", platformRole: "unknown", currentGroup: null, ...emptyEntry() });
      const person = people.get(userId)!;
      const project = projectId ? projects.get(projectId) : undefined;
      addCostLine(person, line); person.requests += 1; person.totalTokens += tokens;
      if (kind === "image") person.imageJobs += 1;
      else if (kind === "video") person.videoJobs += 1;
      else if (kind === "agent") person.agentTurns += 1;
      else person.scriptRuns += 1;
      if (project) { addCostLine(project, line); project.requests += 1; project.totalTokens += tokens; if (kind === "image") project.imageJobs += 1; else if (kind === "video") project.videoJobs += 1; else if (kind === "agent") project.agentTurns += 1; else project.scriptRuns += 1; }
      addCostLine(total, line); total.requests += 1; total.totalTokens += tokens;
      if (kind === "image") total.imageJobs += 1;
      else if (kind === "video") total.videoJobs += 1;
      else if (kind === "agent") total.agentTurns += 1;
      else total.scriptRuns += 1;
      const membership = groupAtTime(membershipHistory, userId, createdAt);
      const group = groups.get(membership?.groupId || unassignedKey)!;
      addCostLine(group, line); group.requests += 1; group.totalTokens += tokens;
      if (kind === "image") group.imageJobs += 1;
      else if (kind === "video") group.videoJobs += 1;
      else if (kind === "agent") group.agentTurns += 1;
      else group.scriptRuns += 1;
      return { projectFound: Boolean(project) };
    };

    let unlinkedProjectRequests = 0;
    let unreconciledMediaJobs = 0;
    let unreconciledScriptRuns = 0;
    for (const job of mediaJobs) {
      const accounting = resolveLabMediaAccounting(job.provider_request_id, ledgerByRequest.get(job.request_id), job.estimated_cost_usd, job.reported_cost_usd, job.accounting_error);
      const settledUsd = accounting.settledUsd;
      const reportedUsd = accounting.reportedUsd ?? job.reported_cost_usd;
      const estimatedUsd = accounting.estimateUsd ?? job.estimated_cost_usd;
      if (!accounting.reconciled) unreconciledMediaJobs += 1;
      if (!applyRequest(job.owner_id, job.project_id, job.created_at, { settledUsd, reportedUsd, estimatedUsd }, job.kind).projectFound) unlinkedProjectRequests += 1;
    }
    for (const run of scriptRuns) {
      const usage = record(record(run.result).usage);
      const promptTokens = numeric(usage.prompt_tokens ?? usage.input_tokens) || 0;
      const completionTokens = numeric(usage.completion_tokens ?? usage.output_tokens) || 0;
      const totalTokens = numeric(usage.total_tokens) ?? promptTokens + completionTokens;
      const accounting = resolveLabMediaAccounting(run.provider_request_id, ledgerByRequest.get(run.request_id), run.estimated_cost_usd, run.reported_cost_usd, run.accounting_error);
      if (!accounting.reconciled) unreconciledScriptRuns += 1;
      if (!applyRequest(run.actor_id, run.project_id, run.created_at, {
        settledUsd: accounting.settledUsd,
        reportedUsd: accounting.reportedUsd ?? run.reported_cost_usd,
        estimatedUsd: accounting.estimateUsd ?? run.estimated_cost_usd,
      }, "script", totalTokens).projectFound) unlinkedProjectRequests += 1;
    }
    let unreconciledAgentTurns = 0;
    for (const row of agentLedgerRows) {
      if (alreadyReportedRequestIds.has(row.request_id)) continue;
      const accounting = resolveLabMediaAccounting(row.provider_request_id, row, row.estimated_cost_usd, row.reported_cost_usd);
      if (!accounting.reconciled) unreconciledAgentTurns += 1;
      const tokens = numeric(row.total_tokens) ?? (numeric(row.input_tokens) || 0) + (numeric(row.output_tokens) || 0);
      if (!applyRequest(row.user_id, row.project_id, row.created_at, {
        settledUsd: accounting.settledUsd,
        reportedUsd: accounting.reportedUsd ?? row.reported_cost_usd,
        estimatedUsd: accounting.estimateUsd ?? row.estimated_cost_usd,
      }, "agent", tokens).projectFound) unlinkedProjectRequests += 1;
    }
    const fx = fxSnapshot();
    const line = (entry: ReportEntry) => ({
      ...entry,
      settledCny: usdToCny(entry.settledUsd, fx.rate), reportedCny: usdToCny(entry.reportedUsd, fx.rate), estimatedCny: usdToCny(entry.estimatedUsd, fx.rate),
    });
    return NextResponse.json({
      totals: line(total),
      people: Array.from(people.values()).map(line).sort((a, b) => b.settledUsd + b.reportedUsd + b.estimatedUsd - (a.settledUsd + a.reportedUsd + a.estimatedUsd)),
      projects: Array.from(projects.values()).map(line).sort((a, b) => b.settledUsd + b.reportedUsd + b.estimatedUsd - (a.settledUsd + a.reportedUsd + a.estimatedUsd)),
      groups: Array.from(groups.values()).map(line).sort((a, b) => b.settledUsd + b.reportedUsd + b.estimatedUsd - (a.settledUsd + a.reportedUsd + a.estimatedUsd)),
      currency: fx,
      coverage: { mediaJobs: mediaJobs.length, mediaJobsTotal: Number(mediaCount[0]?.count || 0), scriptRuns: scriptRuns.length, scriptRunsTotal: Number(scriptCount[0]?.count || 0), agentTurns: agentLedgerRows.filter(row => !alreadyReportedRequestIds.has(row.request_id)).length, agentTurnsTotal: agentLedgerTotal, maxRows: 10000, complete: mediaJobs.length === Number(mediaCount[0]?.count || 0) && scriptRuns.length === Number(scriptCount[0]?.count || 0) && agentLedgerRows.length === agentLedgerTotal, unreconciledMediaJobs, unreconciledScriptRuns, unreconciledAgentTurns, unlinkedProjectRequests },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message.includes("WeToken") ? error.message : "第六板块费用报表暂不可用；请检查账单账本、数据库迁移与服务状态" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const actor = await requireSuperadmin();
  if (!actor) return NextResponse.json({ error: "仅超级管理员可管理第六板块" }, { status: 403 });
  if (!hasSameOriginLabRequest(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  const action = typeof body.action === "string" ? body.action : "";
  const databaseClient = database();
  try {
    if (action === "createGroup" || action === "renameGroup") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      const groupId = typeof body.groupId === "string" ? body.groupId : "";
      if (name.length < 1) return NextResponse.json({ error: "小组名称不能为空" }, { status: 400 });
      if (action === "createGroup") {
        const id = randomUUID();
        const client = await databaseClient.connect();
        try {
          await client.query("BEGIN");
          await client.query("INSERT INTO production_lab_groups(id,name,created_by) VALUES($1,$2,$3)", [id, name, actor.id]);
          await client.query("INSERT INTO production_lab_admin_events(actor_id,action,group_id,details) VALUES($1,'group_created',$2,$3::jsonb)", [actor.id, id, JSON.stringify({ name })]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      } else {
        if (!groupId) return NextResponse.json({ error: "小组编号无效" }, { status: 400 });
        const client = await databaseClient.connect();
        try {
          await client.query("BEGIN");
          const previous = await client.query<GroupRow>("SELECT id,name FROM production_lab_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [groupId]);
          if (!previous.rowCount) throw new Error("小组不存在或已停用");
          await client.query("UPDATE production_lab_groups SET name=$2,updated_at=now() WHERE id=$1", [groupId, name]);
          await client.query("UPDATE production_lab_group_memberships SET group_name_snapshot=$2 WHERE group_id=$1 AND unassigned_at IS NULL", [groupId, name]);
          await client.query("INSERT INTO production_lab_admin_events(actor_id,action,group_id,details) VALUES($1,'group_renamed',$2,$3::jsonb)", [actor.id, groupId, JSON.stringify({ from: previous.rows[0].name, to: name })]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "archiveGroup") {
      const groupId = typeof body.groupId === "string" ? body.groupId : "";
      if (!groupId) return NextResponse.json({ error: "小组编号无效" }, { status: 400 });
      const client = await databaseClient.connect();
      try {
        await client.query("BEGIN");
        const group = await client.query<GroupRow>("SELECT id,name FROM production_lab_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [groupId]);
        if (!group.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "小组不存在或已停用" }, { status: 409 }); }
        const members = await client.query("SELECT 1 FROM production_lab_group_memberships WHERE group_id=$1 AND unassigned_at IS NULL LIMIT 1", [groupId]);
        if (members.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "该小组仍有成员；请先调整成员归属" }, { status: 409 }); }
        await client.query("UPDATE production_lab_groups SET archived_at=now(),updated_at=now() WHERE id=$1", [groupId]);
        await client.query("INSERT INTO production_lab_admin_events(actor_id,action,group_id,details) VALUES($1,'group_archived',$2,$3::jsonb)", [actor.id, groupId, JSON.stringify({ name: group.rows[0].name })]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return NextResponse.json({ ok: true });
    }
    if (action === "assignMember") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const groupId = typeof body.groupId === "string" ? body.groupId : null;
      if (!userId || userId.length > 120) return NextResponse.json({ error: "平台账号编号无效" }, { status: 400 });
      const account = await createAdminClient().from("app_users").select("id,email").eq("id", userId).maybeSingle();
      if (account.error || !account.data) return NextResponse.json({ error: "找不到此平台账号" }, { status: 404 });
      const client = await databaseClient.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
        const targetGroup = groupId ? await client.query<GroupRow>("SELECT id,name FROM production_lab_groups WHERE id=$1 AND archived_at IS NULL FOR SHARE", [groupId]) : null;
        if (groupId && !targetGroup?.rowCount) throw new Error("所选小组不存在或已停用");
        const current = await client.query<MembershipRow>("SELECT id,group_id,group_name_snapshot FROM production_lab_group_memberships WHERE user_id=$1 AND unassigned_at IS NULL FOR UPDATE", [userId]);
        const previous = current.rows[0];
        if (previous?.group_id === groupId || (!previous && !groupId)) { await client.query("COMMIT"); return NextResponse.json({ ok: true, unchanged: true }); }
        if (previous) await client.query("UPDATE production_lab_group_memberships SET unassigned_at=now(),unassigned_by=$2 WHERE id=$1", [previous.id, actor.id]);
        const nextGroupName = groupId ? targetGroup!.rows[0].name : null;
        if (groupId) await client.query("INSERT INTO production_lab_group_memberships(group_id,user_id,group_name_snapshot,assigned_by) VALUES($1,$2,$3,$4)", [groupId, userId, nextGroupName, actor.id]);
        await client.query("INSERT INTO production_lab_admin_events(actor_id,action,group_id,details) VALUES($1,'member_assignment_changed',$2,$3::jsonb)", [actor.id, groupId, JSON.stringify({ userId, email: account.data.email, fromGroup: previous?.group_name_snapshot || null, toGroup: nextGroupName })]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "不支持的管理操作" }, { status: 400 });
  } catch (error) {
    const postgresError = error as Error & { code?: string };
    if (postgresError.code === "23505") return NextResponse.json({ error: "已有同名小组，请换一个名称" }, { status: 409 });
    if (error instanceof Error && ["小组不存在或已停用", "所选小组不存在或已停用"].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "保存小组调整失败；历史归属未清除，请检查数据库状态后重试" }, { status: 503 });
  }
}
