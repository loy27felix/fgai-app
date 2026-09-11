import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { createAdminClient } from '@/lib/local/admin';
import { isMonthStartKey } from '@/lib/usage/budget';
import { parseWetokenFeeLogCsv, type WetokenFeeLogEntry } from '@/lib/usage/wetoken-fee-log';
import {
  resolveWetokenFeeEntry,
  summarizeWetokenFeeResolutions,
  type FeeCreatorTaskMatch,
  type FeeLedgerMatch,
  type FeeProjectTaskMatch,
  type WetokenFeeResolution,
} from '@/lib/usage/wetoken-fee-reconciliation';
import { logServerEvent, logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

const MAX_IMPORT_BYTES = 15_000_000;
const QUERY_BATCH_SIZE = 500;

type LocalLedger = FeeLedgerMatch & { priceSnapshot: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function batches<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function asMonthStart(value: unknown) {
  const month = typeof value === 'string' ? value.trim() : '';
  return isMonthStartKey(month) ? month : null;
}

function isEntryInMonth(entry: WetokenFeeLogEntry, monthStart: string) {
  return entry.occurredAt.startsWith(monthStart.slice(0, 7));
}

function usageKind(value: string): 'text' | 'image' | 'video' {
  return value === 'image' || value === 'video' ? value : 'text';
}

function usageStatus(value: string): 'submitted' | 'succeeded' | 'failed' | 'unknown' {
  if (value === 'succeeded') return 'succeeded';
  if (value === 'failed' || value === 'expired') return 'failed';
  if (value === 'submitted' || value === 'queued' || value === 'running') return 'submitted';
  return 'unknown';
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function requestResolution(request: Record<string, unknown>) {
  const value = request.resolution || request.size;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requestDuration(request: Record<string, unknown>) {
  return numberValue(request.duration || request.video_seconds);
}

function reconciliationSnapshot(entry: WetokenFeeLogEntry, source: string, request: Record<string, unknown>) {
  return {
    ...request,
    reconciliation_source: 'wetoken_fee_log_csv',
    reconciliation_kind: source,
    reconciled_at: new Date().toISOString(),
    wetoken_reference_id: entry.referenceId,
    wetoken_model: entry.model,
    wetoken_fee_time: entry.occurredAt,
    reported_currency: 'USD',
  };
}

function creatorLedgerRow(entry: WetokenFeeLogEntry, task: FeeCreatorTaskMatch) {
  return {
    request_id: `wetoken-reconciled:creator:${task.id}`,
    provider_request_id: entry.referenceId,
    user_id: task.userId,
    workspace_id: task.workspaceId,
    project_id: null,
    creator_task_id: task.id,
    kind: usageKind(task.kind),
    provider: task.provider || 'wetoken',
    model: task.model || entry.model || '未知模型',
    image_count: task.kind === 'image' ? 1 : 0,
    video_seconds: task.kind === 'video' ? requestDuration(task.request) : 0,
    resolution: requestResolution(task.request),
    generate_audio: task.request.generate_audio === true,
    reported_cost_usd: Number(entry.actualCostUsd.toFixed(10)),
    cost_source: 'reported',
    price_snapshot: reconciliationSnapshot(entry, 'creator_task_backfill', task.request),
    status: usageStatus(task.status),
    possibly_charged: true,
    created_at: entry.occurredAt || task.createdAt,
  };
}

function projectLedgerRow(entry: WetokenFeeLogEntry, task: FeeProjectTaskMatch) {
  return {
    request_id: `wetoken-reconciled:project:${task.id}`,
    provider_request_id: entry.referenceId,
    user_id: task.userId,
    workspace_id: null,
    project_id: task.projectId,
    creator_task_id: null,
    kind: usageKind(task.kind),
    provider: task.provider || 'wetoken',
    model: task.model || entry.model || '未知模型',
    image_count: task.kind === 'image' ? 1 : 0,
    video_seconds: task.kind === 'video' ? requestDuration(task.request) : 0,
    resolution: requestResolution(task.request),
    generate_audio: task.request.generate_audio === true,
    reported_cost_usd: Number(entry.actualCostUsd.toFixed(10)),
    cost_source: 'reported',
    price_snapshot: reconciliationSnapshot(entry, 'project_task_backfill', task.request),
    status: usageStatus(task.status),
    possibly_charged: true,
    created_at: entry.occurredAt || task.createdAt,
  };
}

function asCreatorTask(row: Record<string, unknown>): FeeCreatorTaskMatch | null {
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string') return null;
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: typeof row.workspace_id === 'string' ? row.workspace_id : null,
    kind: typeof row.kind === 'string' ? row.kind : '',
    provider: typeof row.provider === 'string' ? row.provider : '',
    model: typeof row.model === 'string' ? row.model : '',
    status: typeof row.status === 'string' ? row.status : 'unknown',
    request: record(row.request),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function asProjectTask(row: Record<string, unknown>): FeeProjectTaskMatch | null {
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string') return null;
  return {
    id: row.id,
    userId: row.user_id,
    projectId: typeof row.project_id === 'string' ? row.project_id : null,
    kind: typeof row.kind === 'string' ? row.kind : '',
    provider: typeof row.provider === 'string' ? row.provider : '',
    model: typeof row.model === 'string' ? row.model : '',
    status: typeof row.status === 'string' ? row.status : 'unknown',
    request: record(row.request),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function appendMap<T>(map: Map<string, T[]>, key: string | null | undefined, value: T) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

async function updateMatchedLedger(
  admin: ReturnType<typeof createAdminClient>,
  ledger: LocalLedger,
  entry: WetokenFeeLogEntry,
  source: string,
) {
  const { error } = await admin
    .from('ai_usage_ledger')
    .update({
      provider_request_id: entry.referenceId,
      reported_cost_usd: Number(entry.actualCostUsd.toFixed(10)),
      cost_source: 'reported',
      price_snapshot: reconciliationSnapshot(entry, source, record(ledger.priceSnapshot)),
    })
    .eq('id', ledger.id);
  if (error) throw error;
}

async function writeException(
  admin: ReturnType<typeof createAdminClient>,
  resolution: Extract<WetokenFeeResolution, { state: 'unallocated_historical' | 'ambiguous' }>,
  monthStart: string,
) {
  const { error } = await admin.from('wetoken_fee_log_exceptions').upsert({
    month_start: monthStart,
    reference_id: resolution.entry.referenceId,
    model: resolution.entry.model,
    occurred_at: resolution.entry.occurredAt || null,
    actual_cost_usd: Number(resolution.entry.actualCostUsd.toFixed(10)),
    classification: resolution.state,
    details: resolution.state === 'ambiguous' ? { reason: resolution.reason } : {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'reference_id' });
  if (error) throw error;
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const localClient = createClient();
    const { data: { user } } = await localClient.auth.getUser();
    if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const { data: profile, error: profileError } = await localClient
      .from('profiles')
      .select('platform_role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.platform_role !== 'admin' && profile?.platform_role !== 'superadmin') {
      return NextResponse.json({ error: '仅管理员可以导入 WeToken 实际账单' }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get('file');
    const monthStart = asMonthStart(form.get('month'));
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择 WeToken 导出的 CSV 文件' }, { status: 400 });
    if (!monthStart) return NextResponse.json({ error: '请选择要对账的月份后重新导入 CSV' }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: '费用 CSV 必须大于 0 且不超过 15MB' }, { status: 400 });
    }
    const parsedEntries = parseWetokenFeeLogCsv(await file.text());
    if (!parsedEntries.length) return NextResponse.json({ error: 'CSV 中没有实际消费记录' }, { status: 400 });
    if (parsedEntries.some((entry) => !isEntryInMonth(entry, monthStart))) {
      return NextResponse.json({ error: `CSV 含有非 ${monthStart.slice(0, 7)} 的费用流水。请先在 WeToken 按月筛选后重新导出，避免跨月混账。` }, { status: 400 });
    }

    const entriesByReference = new Map<string, WetokenFeeLogEntry>();
    for (const entry of parsedEntries) {
      const existing = entriesByReference.get(entry.referenceId);
      if (existing && (existing.actualCostUsd !== entry.actualCostUsd || existing.occurredAt !== entry.occurredAt)) {
        return NextResponse.json({ error: `账单中 Reference ID ${entry.referenceId} 出现了金额或时间不一致的重复记录，已停止导入。` }, { status: 400 });
      }
      entriesByReference.set(entry.referenceId, entry);
    }
    const entries = [...entriesByReference.values()];
    const references = [...entriesByReference.keys()];
    const admin = createAdminClient();

    const ledgerByReference = new Map<string, LocalLedger[]>();
    const creatorTasksByReference = new Map<string, FeeCreatorTaskMatch[]>();
    const projectTasksByReference = new Map<string, FeeProjectTaskMatch[]>();
    for (const group of batches(references, QUERY_BATCH_SIZE)) {
      const [ledgerResult, creatorTaskResult, projectTaskResult] = await Promise.all([
        admin.from('ai_usage_ledger').select('id,provider_request_id,creator_task_id,price_snapshot').in('provider_request_id', group),
        admin.from('creator_generation_tasks').select('id,user_id,workspace_id,kind,provider,model,status,request,created_at,external_task_id').in('external_task_id', group),
        admin.from('generation_tasks').select('id,user_id,project_id,kind,provider,model,status,request,created_at,external_task_id').in('external_task_id', group),
      ]);
      if (ledgerResult.error) throw ledgerResult.error;
      if (creatorTaskResult.error) throw creatorTaskResult.error;
      if (projectTaskResult.error) throw projectTaskResult.error;
      for (const row of ledgerResult.data || []) {
        const value = row as { id: string; provider_request_id?: string | null; creator_task_id?: string | null; price_snapshot: unknown };
        appendMap(ledgerByReference, value.provider_request_id, { id: value.id, providerRequestId: value.provider_request_id, creatorTaskId: value.creator_task_id, priceSnapshot: value.price_snapshot });
      }
      for (const row of creatorTaskResult.data || []) {
        const task = asCreatorTask(row as Record<string, unknown>);
        const reference = typeof (row as { external_task_id?: unknown }).external_task_id === 'string'
          ? (row as { external_task_id: string }).external_task_id : null;
        if (task) appendMap(creatorTasksByReference, reference, task);
      }
      for (const row of projectTaskResult.data || []) {
        const task = asProjectTask(row as Record<string, unknown>);
        const reference = typeof (row as { external_task_id?: unknown }).external_task_id === 'string'
          ? (row as { external_task_id: string }).external_task_id : null;
        if (task) appendMap(projectTasksByReference, reference, task);
      }
    }

    const creatorTaskIds = [...new Set([...creatorTasksByReference.values()].flat().map((task) => task.id))];
    const creatorLedgersByTaskId = new Map<string, LocalLedger[]>();
    for (const group of batches(creatorTaskIds, QUERY_BATCH_SIZE)) {
      if (!group.length) continue;
      const result = await admin.from('ai_usage_ledger').select('id,provider_request_id,creator_task_id,price_snapshot').in('creator_task_id', group);
      if (result.error) throw result.error;
      for (const row of result.data || []) {
        const value = row as { id: string; provider_request_id?: string | null; creator_task_id?: string | null; price_snapshot: unknown };
        appendMap(creatorLedgersByTaskId, value.creator_task_id, { id: value.id, providerRequestId: value.provider_request_id, creatorTaskId: value.creator_task_id, priceSnapshot: value.price_snapshot });
      }
    }

    const resolutions = entries.map((entry) => resolveWetokenFeeEntry(entry, {
      ledgerByReference,
      creatorTasksByReference,
      creatorLedgersByTaskId,
      projectTasksByReference,
    }));
    const summary = summarizeWetokenFeeResolutions(resolutions);

    for (const resolution of resolutions) {
      if (resolution.state === 'ledger_matched') {
        await updateMatchedLedger(admin, resolution.ledger as LocalLedger, resolution.entry, 'ledger_exact_match');
      } else if (resolution.state === 'creator_ledger_recovered') {
        await updateMatchedLedger(admin, resolution.ledger as LocalLedger, resolution.entry, 'creator_task_ledger_recovery');
      } else if (resolution.state === 'creator_task_recovered') {
        const { error } = await admin.from('ai_usage_ledger').upsert(creatorLedgerRow(resolution.entry, resolution.task), { onConflict: 'request_id' });
        if (error) throw error;
      } else if (resolution.state === 'project_task_recovered') {
        const { error } = await admin.from('ai_usage_ledger').upsert(projectLedgerRow(resolution.entry, resolution.task), { onConflict: 'request_id' });
        if (error) throw error;
      } else {
        await writeException(admin, resolution, monthStart);
      }
    }

    const resolvedReferences = resolutions
      .filter((resolution) => resolution.state !== 'unallocated_historical' && resolution.state !== 'ambiguous')
      .map((resolution) => resolution.entry.referenceId);
    for (const group of batches(resolvedReferences, QUERY_BATCH_SIZE)) {
      if (!group.length) continue;
      const { error } = await admin.from('wetoken_fee_log_exceptions').delete().in('reference_id', group);
      if (error) throw error;
    }

    const { error: importError } = await admin.from('wetoken_fee_log_imports').insert({
      month_start: monthStart,
      source_file_name: file.name,
      imported_by: user.id,
      imported_count: summary.totalCount,
      imported_cost_usd: summary.totalCostUsd,
      ledger_matched_count: summary.ledgerMatchedCount,
      ledger_matched_cost_usd: summary.ledgerMatchedCostUsd,
      creator_recovered_count: summary.creatorRecoveredCount,
      creator_recovered_cost_usd: summary.creatorRecoveredCostUsd,
      project_recovered_count: summary.projectRecoveredCount,
      project_recovered_cost_usd: summary.projectRecoveredCostUsd,
      unallocated_count: summary.unallocatedCount,
      unallocated_cost_usd: summary.unallocatedCostUsd,
      ambiguous_count: summary.ambiguousCount,
      ambiguous_cost_usd: summary.ambiguousCostUsd,
      breakdown: {
        unallocatedByModel: summary.unallocatedByModel,
        ambiguousByModel: summary.ambiguousByModel,
      },
    });
    if (importError) throw importError;

    logServerEvent('billing', {
      feature: 'usage_reconciliation',
      stage: 'wetoken_fee_log_imported',
      traceId,
      actorId: user.id,
      monthStart,
      imported: summary.totalCount,
      ledgerMatched: summary.ledgerMatchedCount,
      creatorRecovered: summary.creatorRecoveredCount,
      projectRecovered: summary.projectRecoveredCount,
      unallocated: summary.unallocatedCount,
      ambiguous: summary.ambiguousCount,
      importedCostUsd: summary.totalCostUsd,
      allocatedCostUsd: Number((summary.ledgerMatchedCostUsd + summary.creatorRecoveredCostUsd + summary.projectRecoveredCostUsd).toFixed(10)),
      unallocatedCostUsd: summary.unallocatedCostUsd,
      ambiguousCostUsd: summary.ambiguousCostUsd,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    logServerFailure('billing', error, { feature: 'usage_reconciliation', stage: 'wetoken_fee_log_import_failed', traceId });
    return NextResponse.json({ error: error instanceof Error ? error.message : '导入 WeToken 费用 CSV 失败' }, { status: 500 });
  }
}
