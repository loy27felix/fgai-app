'use client';

import { useEffect, useState } from 'react';
import type { LogDetail, LogRecord } from '@/lib/observability/log-search-contract';
import { detailFields, jsonText, categoryLabel } from './log-detail-formatters';

export default function LogInspector({ row, state, onClose, onRetry }: { row: LogRecord | null; state: { status: 'idle' | 'loading' | 'ready' | 'error'; value: LogDetail | null; error: string }; onClose: () => void; onRetry: () => void }) {
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!row) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [row, onClose]);
  if (!row) return null;
  const detail = state.value;
  const payload = detail ? jsonText(detail) : '';

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1_500);
    } catch {
      setCopied('复制失败');
    }
  }

  return (
    <aside className="log-desk__inspector" role="dialog" aria-modal="true" aria-labelledby="log-detail-title">
      <div className="log-desk__inspector-head"><div><span className="log-desk__eyebrow">LOG DETAIL</span><h2 id="log-detail-title">{row.event || '日志详情'}</h2></div><button type="button" onClick={onClose} aria-label="关闭详情">×</button></div>
      {state.status === 'loading' && <div className="log-desk__inspector-state">正在读取这条日志的完整信息…</div>}
      {state.status === 'error' && <div className="log-desk__inspector-state is-error"><strong>详情读取失败</strong><span>{state.error}</span><button type="button" onClick={onRetry}>重试</button></div>}
      {detail && (
        <>
          <div className="log-desk__inspector-badge"><span>{categoryLabel(detail.category)}</span><b className={`log-desk__level-dot log-desk__level-dot--${detail.level}`}>{detail.level}</b></div>
          <dl className="log-desk__detail-fields">
            {detailFields(detail).map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
          </dl>
          <div className="log-desk__detail-actions"><button type="button" onClick={() => copy('ID', detail.id)}>复制日志 ID</button><button type="button" onClick={() => copy('JSON', payload)}>复制 JSON</button>{copied && <span>{copied === '复制失败' ? copied : `${copied}已复制`}</span>}</div>
          <details className="log-desk__payload" open><summary>完整脱敏 payload</summary><pre>{payload}</pre></details>
        </>
      )}
    </aside>
  );
}
