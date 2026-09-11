import { NextResponse } from 'next/server';
import { createClient } from '@/lib/local/server';
import { createAdminClient } from '@/lib/local/admin';
import { parseWetokenFeeLogCsv } from '@/lib/usage/wetoken-fee-log';
import { logServerEvent, logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

const MAX_IMPORT_BYTES = 15_000_000;
const QUERY_BATCH_SIZE = 500;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function batches<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
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
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择 WeToken 导出的 CSV 文件' }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: '费用 CSV 必须大于 0 且不超过 15MB' }, { status: 400 });
    }
    const entries = parseWetokenFeeLogCsv(await file.text());
    if (!entries.length) return NextResponse.json({ error: 'CSV 中没有“消费 / 成功”的实际费用记录' }, { status: 400 });

    // A fee-log Reference ID is exactly the provider request/task ID.  Never
    // fall back to fuzzy model/time matching: that would break per-user auditability.
    const byReference = new Map<string, typeof entries[number]>();
    for (const entry of entries) {
      const existing = byReference.get(entry.referenceId);
      if (existing && (existing.actualCostUsd !== entry.actualCostUsd || existing.occurredAt !== entry.occurredAt)) {
        return NextResponse.json({ error: `账单中 Reference ID ${entry.referenceId} 出现了金额或时间不一致的重复记录，已停止导入。` }, { status: 400 });
      }
      byReference.set(entry.referenceId, entry);
    }
    const references = [...byReference.keys()];
    const admin = createAdminClient();
    const rowsByReference = new Map<string, Array<{ id: string; provider_request_id: string; price_snapshot: unknown }>>();
    for (const group of batches(references, QUERY_BATCH_SIZE)) {
      const { data, error } = await admin
        .from('ai_usage_ledger')
        .select('id,provider_request_id,price_snapshot')
        .in('provider_request_id', group);
      if (error) throw error;
      for (const row of data || []) {
        if (typeof row.provider_request_id === 'string' && byReference.has(row.provider_request_id)) {
          const value = row as { id: string; provider_request_id: string; price_snapshot: unknown };
          const matchingRows = rowsByReference.get(value.provider_request_id) || [];
          matchingRows.push(value);
          rowsByReference.set(value.provider_request_id, matchingRows);
        }
      }
    }

    const matchedRows: Array<{ id: string; provider_request_id: string; price_snapshot: unknown }> = [];
    const ambiguousReferences: string[] = [];
    for (const referenceId of references) {
      const matchingRows = rowsByReference.get(referenceId) || [];
      if (matchingRows.length === 1) matchedRows.push(matchingRows[0]);
      else if (matchingRows.length > 1) ambiguousReferences.push(referenceId);
    }
    const importedCostUsd = Number(entries.reduce((total, entry) => total + entry.actualCostUsd, 0).toFixed(10));
    const matchedCostUsd = Number(matchedRows.reduce((total, row) => total + (byReference.get(row.provider_request_id)?.actualCostUsd || 0), 0).toFixed(10));
    let settled = 0;
    for (const row of matchedRows) {
      const entry = byReference.get(row.provider_request_id);
      if (!entry) continue;
      const snapshot = record(row.price_snapshot);
      const { error } = await admin
        .from('ai_usage_ledger')
        .update({
          reported_cost_usd: Number(entry.actualCostUsd.toFixed(10)),
          cost_source: 'reported',
          price_snapshot: {
            ...snapshot,
            reconciliation_source: 'wetoken_fee_log_csv',
            reconciled_at: new Date().toISOString(),
            reconciled_by: user.id,
            wetoken_reference_id: entry.referenceId,
            wetoken_model: entry.model,
            wetoken_fee_time: entry.occurredAt,
            reported_currency: 'USD',
          },
        })
        .eq('id', row.id);
      if (error) throw error;
      settled += 1;
    }

    const unmatched = Math.max(0, entries.length - matchedRows.length - ambiguousReferences.length);
    logServerEvent('billing', {
      feature: 'usage_reconciliation',
      stage: 'wetoken_fee_log_imported',
      traceId,
      actorId: user.id,
      imported: entries.length,
      matched: matchedRows.length,
      settled,
      unmatched,
      ambiguous: ambiguousReferences.length,
      importedCostUsd,
      matchedCostUsd,
    });
    return NextResponse.json({ ok: true, imported: entries.length, matched: matchedRows.length, settled, unmatched, ambiguous: ambiguousReferences.length, importedCostUsd, matchedCostUsd });
  } catch (error) {
    logServerFailure('billing', error, { feature: 'usage_reconciliation', stage: 'wetoken_fee_log_import_failed', traceId });
    return NextResponse.json({ error: error instanceof Error ? error.message : '导入 WeToken 费用 CSV 失败' }, { status: 500 });
  }
}
