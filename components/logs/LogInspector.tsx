'use client';

import { useEffect, useRef, useState } from 'react';
import type { LogDetail, LogRecord } from '@/lib/observability/log-search-contract';
import { categoryLabel, detailFields, detailSections, jsonText, type DetailBody, type DetailSection, type ExchangeError, type ExchangeSide } from './log-detail-formatters';

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function bodyStatus(body: DetailBody) {
  if (body.capture === 'empty') return '已采集空 Body。';
  if (body.capture === 'binary') return '已识别二进制 Body，内容不在界面展开。';
  if (body.capture === 'unavailable') return 'Body 读取不可用。';
  return null;
}

function ExchangeContent({ exchange }: { exchange: ExchangeSide }) {
  const body = exchange.body;
  const captureNote = body ? bodyStatus(body) : null;
  return (
    <div className="log-desk__detail-section-body">
      <dl className="log-desk__detail-kv">
        {exchange.method && <div><dt>方法</dt><dd>{exchange.method}</dd></div>}
        {exchange.url && <div><dt>地址</dt><dd title={exchange.url}>{exchange.url}</dd></div>}
        {exchange.status && <div><dt>状态</dt><dd>{exchange.status}{exchange.statusText ? ` · ${exchange.statusText}` : ''}</dd></div>}
      </dl>
      <section className="log-desk__detail-subsection">
        <h3>Headers</h3>
        {exchange.headers.length ? (
          <dl className="log-desk__headers">
            {exchange.headers.map((header) => <div key={header.name}><dt>{header.name}</dt><dd>{header.value}</dd></div>)}
          </dl>
        ) : <p className="log-desk__detail-section-note">{exchange.headersCaptured ? '已采集 Headers，但为空对象。' : '采集端未记录 Headers。'}</p>}
      </section>
      <section className="log-desk__detail-subsection">
        <h3>Body / 参数</h3>
        {body ? (
          <>
            <div className="log-desk__detail-meta">{body.encoding || '未标注编码'}{body.bytes === null ? '' : ` · ${body.bytes} bytes`}{body.truncated ? ' · 已截断' : ''}</div>
            {captureNote ? <p className="log-desk__detail-section-note">{captureNote}</p> : <pre className="log-desk__detail-code">{displayValue(body.value)}</pre>}
          </>
        ) : <p className="log-desk__detail-section-note">采集端未记录 Body 或参数。</p>}
      </section>
    </div>
  );
}

function ErrorContent({ error }: { error: ExchangeError }) {
  return (
    <div className="log-desk__detail-section-body">
      <dl className="log-desk__detail-kv">
        {error.name && <div><dt>名称</dt><dd>{error.name}</dd></div>}
        {error.message && <div><dt>消息</dt><dd>{error.message}</dd></div>}
        {error.code && <div><dt>Code</dt><dd>{error.code}</dd></div>}
        {error.status && <div><dt>状态</dt><dd>{error.status}</dd></div>}
        {error.retryable && <div><dt>可重试</dt><dd>{error.retryable}</dd></div>}
      </dl>
      {error.cause !== null && error.cause !== undefined && <pre className="log-desk__detail-code">{displayValue(error.cause)}</pre>}
      {error.stack && <details className="log-desk__nested-details"><summary>Stack</summary><pre className="log-desk__detail-code">{error.stack}</pre></details>}
    </div>
  );
}

function DetailSectionView({ section }: { section: DetailSection }) {
  const open = section.id === 'request' || section.id === 'response' || section.id === 'error';
  const [isOpen, setIsOpen] = useState(open);
  return (
    <details className="log-desk__detail-section" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>{section.title}</summary>
      {section.exchange && <ExchangeContent exchange={section.exchange} />}
      {section.error && <ErrorContent error={section.error} />}
      {section.fields && (
        <div className="log-desk__detail-section-body">
          <dl className="log-desk__detail-kv">
            {section.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{displayValue(field.value)}</dd></div>)}
          </dl>
        </div>
      )}
    </details>
  );
}

export default function LogInspector({ row, state, onClose, onRetry }: { row: LogRecord | null; state: { status: 'idle' | 'loading' | 'ready' | 'error'; value: LogDetail | null; error: string }; onClose: () => void; onRetry: () => void }) {
  const [copied, setCopied] = useState('');
  const [isOverlay, setIsOverlay] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1560px)');
    const update = () => setIsOverlay(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!row) return undefined;
    if (isOverlay) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (isOverlay && restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
    };
  }, [isOverlay, onClose, row]);
  if (!row) return null;
  const detail = state.value;
  const payload = detail ? jsonText(detail) : '';
  const sections = detail ? detailSections(detail) : [];

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
    <aside ref={inspectorRef} className="log-desk__inspector" aria-label="日志详情" aria-labelledby="log-detail-title">
      <div className="log-desk__inspector-head"><div><span className="log-desk__eyebrow">LOG DETAIL</span><h2 id="log-detail-title">{row.event || '日志详情'}</h2></div><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭详情">×</button></div>
      {state.status === 'loading' && <div className="log-desk__inspector-state">正在读取这条日志的完整信息…</div>}
      {state.status === 'error' && <div className="log-desk__inspector-state is-error"><strong>详情读取失败</strong><span>{state.error}</span><button type="button" onClick={onRetry}>重试</button></div>}
      {detail && (
        <>
          <div className="log-desk__inspector-badge"><span>{categoryLabel(detail.category)}</span><b className={`log-desk__level-dot log-desk__level-dot--${detail.level}`}>{detail.level}</b></div>
          <dl className="log-desk__detail-fields">
            {detailFields(detail).map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
          </dl>
          <div className="log-desk__detail-actions"><button type="button" onClick={() => copy('ID', detail.id)}>复制日志 ID</button><button type="button" onClick={() => copy('JSON', payload)}>复制 JSON</button>{copied && <span>{copied === '复制失败' ? copied : `${copied}已复制`}</span>}</div>
          {sections.map((section) => <DetailSectionView key={`${detail.id}:${section.id}`} section={section} />)}
          <details className="log-desk__payload"><summary>完整脱敏 payload</summary><pre>{payload}</pre></details>
        </>
      )}
    </aside>
  );
}
