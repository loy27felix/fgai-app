'use client';

import type { LogTimelineBucket } from '@/lib/observability/log-search-contract';

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function LogTimeline({ timeline, onBucketSelect, onExpand }: { timeline: LogTimelineBucket[]; onBucketSelect: (bucket: LogTimelineBucket) => void; onExpand: () => void }) {
  if (!timeline.length) {
    return (
      <div className="log-desk__empty-strip">
        <span>当前范围没有时间分布</span>
        <button type="button" onClick={onExpand}>扩大到近 1 小时</button>
      </div>
    );
  }
  const max = Math.max(1, ...timeline.map((bucket) => bucket.total));
  return (
    <section className="log-desk__timeline" aria-label="时间分布">
      <div className="log-desk__timeline-head"><span>时间分布</span><span>{timeline.length} 个时间桶</span></div>
      <div className="log-desk__density-strip">
        {timeline.map((bucket) => (
          <button key={bucket.bucket} type="button" style={{ '--density': `${Math.max(8, (bucket.total / max) * 100)}%` } as React.CSSProperties} onClick={() => onBucketSelect(bucket)} title={`${timeLabel(bucket.bucket)} · ${bucket.total} 条日志`} aria-label={`${timeLabel(bucket.bucket)}，${bucket.total} 条日志`}>
            <span />
          </button>
        ))}
      </div>
      <div className="log-desk__timeline-scale"><span>{timeLabel(timeline[0].bucket)}</span><span>{timeLabel(timeline[timeline.length - 1].bucket)}</span></div>
    </section>
  );
}
