'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CREATOR_USAGE_UPDATED_EVENT } from '@/lib/creator/usage-events';

type UsageRecord = {
  id: string;
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

type UsageResponse = {
  records: UsageRecord[];
  count: number;
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    images: number;
    videoSeconds: number;
    knownCostUsd: number;
    knownCostCny: number;
    unpriced: number;
  };
  fx?: { rate: number; source?: string };
};

const emptyData: UsageResponse = {
  records: [],
  count: 0,
  totals: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, images: 0, videoSeconds: 0, knownCostUsd: 0, knownCostCny: 0, unpriced: 0 },
};

function kindLabel(kind: UsageRecord['kind']) {
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文本';
}

function statusLabel(status: UsageRecord['status']) {
  return status === 'submitted' ? '已提交' : status === 'succeeded' ? '已完成' : status === 'failed' ? '失败' : '待对账';
}

function statusColor(status: UsageRecord['status']) {
  return status === 'failed' ? '#ff9b85' : status === 'unknown' ? '#e6b85c' : 'var(--accent, #4ade80)';
}

function costLabel(record: UsageRecord, usdToCnyRate: number) {
  const cost = record.reported_cost_usd ?? record.estimated_cost_usd;
  if (cost === null) return '待核算';
  return record.currency === 'USD' ? `$${cost.toFixed(6)} · ¥${(cost * usdToCnyRate).toFixed(4)}` : `${record.currency} ${cost.toFixed(6)}`;
}

function recordMeta(record: UsageRecord) {
  if (record.kind === 'text') return `${record.total_tokens.toLocaleString()} tokens · 输入 ${record.input_tokens.toLocaleString()} / 输出 ${record.output_tokens.toLocaleString()}`;
  if (record.kind === 'image') return `${record.image_count || 1} 张${record.resolution ? ` · ${record.resolution}` : ''}`;
  return `${record.video_seconds || 0}s${record.resolution ? ` · ${record.resolution}` : ''}`;
}

function timeLabel(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function CreatorUsageLedger() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<UsageResponse>(emptyData);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/creator/usage?limit=100', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '用量记录加载失败');
      setData({ records: Array.isArray(payload.records) ? payload.records : [], count: Number(payload.count || 0), totals: { ...emptyData.totals, ...(payload.totals || {}) }, fx: payload.fx || undefined });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '用量记录加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onUpdated = () => {
      if (open) void refresh();
    };
    window.addEventListener(CREATOR_USAGE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(CREATOR_USAGE_UPDATED_EVENT, onUpdated);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const latest = data.records[0];
  const usdToCnyRate = data.fx?.rate || 6.77;
  const summaryLabel = useMemo(() => {
    if (!data.totals.calls) return '暂无生成记录';
    return data.totals.knownCostUsd > 0 ? `已核算 $${data.totals.knownCostUsd.toFixed(4)} · ¥${data.totals.knownCostCny.toFixed(2)}` : `${data.totals.calls} 次调用`;
  }, [data.totals.calls, data.totals.knownCostUsd, data.totals.knownCostCny]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="查看自己的生成与费用记录"
        style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 80, display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 11px', border: '1px solid var(--stroke-2, rgba(120,130,150,.3))', borderRadius: 999, background: 'var(--panel-solid, #fff)', color: 'var(--text, #111)', boxShadow: '0 10px 30px rgba(0,0,0,.18)', cursor: 'pointer', fontSize: 11 }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent, #4ade80)' }} />
        用量记录
        {latest ? <span style={{ color: 'var(--text-3, #777)' }}>{summaryLabel}</span> : null}
      </button>

      {open ? (
        <div role="presentation" onMouseDown={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(3,7,14,.62)', backdropFilter: 'blur(8px)' }}>
          <section role="dialog" aria-modal="true" aria-labelledby="fg-usage-title" onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(720px, 100%)', maxHeight: 'min(760px, 90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--stroke-2, rgba(120,130,150,.35))', borderRadius: 18, background: 'var(--panel-solid, #fff)', color: 'var(--text, #111)', boxShadow: '0 30px 100px rgba(0,0,0,.35)' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--stroke, rgba(120,130,150,.2))' }}>
              <div><div id="fg-usage-title" style={{ fontSize: 15, fontWeight: 700 }}>生成与费用记录</div><div style={{ marginTop: 4, color: 'var(--text-3, #777)', fontSize: 11 }}>只显示当前账号；金额以供应商账单为准，人民币按 1 USD = ¥{usdToCnyRate.toFixed(4)} 换算。</div></div>
              <div style={{ display: 'flex', gap: 7 }}><button type="button" onClick={() => void refresh()} disabled={loading} style={{ height: 30, padding: '0 10px', border: '1px solid var(--stroke, rgba(120,130,150,.25))', borderRadius: 8, background: 'transparent', color: 'var(--text-2, #555)', cursor: 'pointer', fontSize: 11 }}>{loading ? '刷新中…' : '刷新'}</button><button type="button" onClick={() => setOpen(false)} style={{ height: 30, padding: '0 10px', border: '1px solid var(--stroke, rgba(120,130,150,.25))', borderRadius: 8, background: 'transparent', color: 'var(--text-2, #555)', cursor: 'pointer', fontSize: 11 }}>关闭</button></div>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, padding: 14, borderBottom: '1px solid var(--stroke, rgba(120,130,150,.2))' }}>
              <Summary label="调用" value={String(data.totals.calls)} />
              <Summary label="Token" value={data.totals.totalTokens.toLocaleString()} />
              <Summary label="图片 / 视频" value={`${data.totals.images} / ${data.totals.videoSeconds}s`} />
              <Summary label="已核算" value={data.totals.knownCostUsd ? `$${data.totals.knownCostUsd.toFixed(6)} · ¥${data.totals.knownCostCny.toFixed(4)}` : '待核算'} />
            </div>
            {error ? <div style={{ margin: '12px 14px 0', padding: '9px 11px', border: '1px solid rgba(255,120,100,.35)', borderRadius: 9, color: '#ff9b85', fontSize: 12 }}>{error}</div> : null}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
              {!data.records.length && !loading ? <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-3, #777)', fontSize: 12 }}>还没有生成记录</div> : null}
              {data.records.map((record) => <div key={record.id || record.request_id} style={{ display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr) auto', gap: 10, alignItems: 'center', padding: '11px 4px', borderBottom: '1px solid var(--stroke, rgba(120,130,150,.16))' }}>
                <div><div style={{ color: 'var(--accent, #4ade80)', fontSize: 11, fontWeight: 700 }}>{kindLabel(record.kind)}</div><div style={{ marginTop: 3, color: 'var(--text-3, #777)', fontSize: 10 }}>{timeLabel(record.created_at)}</div></div>
                <div style={{ minWidth: 0 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600 }}>{record.model}</div><div style={{ marginTop: 4, color: 'var(--text-3, #777)', fontSize: 10 }}>{recordMeta(record)} · {record.provider || 'provider'}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ color: statusColor(record.status), fontSize: 11 }}>{statusLabel(record.status)}</div><div style={{ marginTop: 3, color: record.cost_source === 'unknown' ? '#e6b85c' : 'var(--text-2, #555)', fontSize: 10 }}>{costLabel(record, usdToCnyRate)}</div></div>
              </div>)}
            </div>
             <footer style={{ padding: '10px 16px', borderTop: '1px solid var(--stroke, rgba(120,130,150,.2))', color: 'var(--text-3, #777)', fontSize: 10 }}>最近显示 {data.records.length} / {data.count} 条；1 USD = ¥{usdToCnyRate.toFixed(4)}；{data.totals.unpriced ? `${data.totals.unpriced} 条等待供应商价格核算。` : '价格均已返回。'}</footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: '9px 10px', border: '1px solid var(--stroke, rgba(120,130,150,.2))', borderRadius: 10, background: 'var(--panel, transparent)' }}><div style={{ color: 'var(--text-3, #777)', fontSize: 10 }}>{label}</div><div style={{ marginTop: 5, fontSize: 13, fontWeight: 700 }}>{value}</div></div>;
}
