import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const USAGE_FIELDS = [
  'id',
  'workspace_id',
  'project_id',
  'creator_task_id',
  'request_id',
  'kind',
  'provider',
  'model',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'image_count',
  'video_seconds',
  'resolution',
  'generate_audio',
  'reported_cost_usd',
  'estimated_cost_usd',
  'currency',
  'cost_source',
  'status',
  'possibly_charged',
  'created_at',
  'completed_at',
].join(',');

type UsageRecord = {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  creator_task_id: string | null;
  request_id: string;
  kind: 'text' | 'image' | 'video';
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  image_count: number;
  video_seconds: number;
  resolution: string | null;
  generate_audio: boolean | null;
  reported_cost_usd: number | null;
  estimated_cost_usd: number | null;
  currency: string;
  cost_source: 'reported' | 'estimated' | 'unknown';
  status: 'submitted' | 'succeeded' | 'failed' | 'unknown';
  possibly_charged: boolean;
  created_at: string;
  completed_at: string | null;
};

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRecord(value: Record<string, unknown>): UsageRecord {
  return {
    id: String(value.id || ''),
    workspace_id: typeof value.workspace_id === 'string' ? value.workspace_id : null,
    project_id: typeof value.project_id === 'string' ? value.project_id : null,
    creator_task_id: typeof value.creator_task_id === 'string' ? value.creator_task_id : null,
    request_id: String(value.request_id || ''),
    kind: value.kind === 'image' || value.kind === 'video' ? value.kind : 'text',
    provider: String(value.provider || ''),
    model: String(value.model || ''),
    input_tokens: numberValue(value.input_tokens),
    output_tokens: numberValue(value.output_tokens),
    total_tokens: numberValue(value.total_tokens),
    image_count: numberValue(value.image_count),
    video_seconds: numberValue(value.video_seconds),
    resolution: typeof value.resolution === 'string' ? value.resolution : null,
    generate_audio: typeof value.generate_audio === 'boolean' ? value.generate_audio : null,
    reported_cost_usd: nullableNumber(value.reported_cost_usd),
    estimated_cost_usd: nullableNumber(value.estimated_cost_usd),
    currency: String(value.currency || 'USD'),
    cost_source: value.cost_source === 'reported' || value.cost_source === 'estimated' ? value.cost_source : 'unknown',
    status: value.status === 'submitted' || value.status === 'succeeded' || value.status === 'failed' ? value.status : 'unknown',
    possibly_charged: value.possibly_charged === true,
    created_at: String(value.created_at || ''),
    completed_at: typeof value.completed_at === 'string' ? value.completed_at : null,
  };
}

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });

  const rawLimit = Number(new URL(req.url).searchParams.get('limit') || 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 100;
  const result = await supabase
    .from('ai_usage_ledger')
    .select(USAGE_FIELDS, { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (result.error) {
    console.error('[creator usage]', result.error);
    return NextResponse.json({ error: '用量记录加载失败，请稍后重试', code: 'USAGE_LOAD_FAILED' }, { status: 500 });
  }

  const records = ((result.data || []) as unknown as Array<Record<string, unknown>>).map(normalizeRecord);
  const totals = records.reduce((summary, record) => {
    summary.calls += 1;
    summary.inputTokens += record.input_tokens;
    summary.outputTokens += record.output_tokens;
    summary.totalTokens += record.total_tokens;
    summary.images += record.image_count;
    summary.videoSeconds += record.video_seconds;
    const cost = record.reported_cost_usd ?? record.estimated_cost_usd;
    if (cost === null) summary.unpriced += 1;
    else summary.knownCostUsd += cost;
    return summary;
  }, { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, images: 0, videoSeconds: 0, knownCostUsd: 0, unpriced: 0 });

  return NextResponse.json({ ok: true, records, count: result.count || records.length, totals });
}
