'use client';

import type { LogFacet, LogCategory, LogScope } from '@/lib/observability/log-search-contract';

const CATEGORY_LABELS: Record<LogCategory, string> = {
  browser: '浏览器日志',
  api: 'API 日志',
  api_runtime: 'API 运行日志',
  infrastructure: '基建日志',
  other: '其他来源',
};

function FacetGroup({ title, items, active, onSelect }: { title: string; items: LogFacet[]; active?: string; onSelect: (value: string) => void }) {
  if (!items.length) return null;
  return (
    <section className="log-desk__facet-group">
      <div className="log-desk__facet-title"><span>{title}</span><small>当前查询结果</small></div>
      <div className="log-desk__facet-items">
        {items.map((item) => (
          <button key={item.value} type="button" className={active === item.value ? 'is-active' : ''} onClick={() => onSelect(item.value)} title={`${item.label} · ${item.count} 条`}>
            <span>{item.label}</span><b>{item.count}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function LogFacets({ facets, scope, level, source, filters, onCategory, onLevel, onSource, onFilter }: {
  facets: { category: LogFacet[]; level: LogFacet[]; source: LogFacet[]; service: LogFacet[]; event: LogFacet[] };
  scope: LogScope;
  level: string;
  source: string;
  filters: Record<string, string>;
  onCategory: (value: LogScope) => void;
  onLevel: (value: string) => void;
  onSource: (value: string) => void;
  onFilter: (key: 'service' | 'event', value: string) => void;
}) {
  const categories = facets.category.map((item) => ({ ...item, label: CATEGORY_LABELS[item.value as LogCategory] || item.label }));
  return (
    <aside className="log-desk__facets" aria-label="日志筛选 Facet">
      <FacetGroup title="类别" items={categories} active={scope} onSelect={(value) => onCategory(value as LogScope)} />
      <FacetGroup title="级别" items={facets.level} active={level} onSelect={onLevel} />
      <FacetGroup title="来源" items={facets.source} active={source} onSelect={onSource} />
      <FacetGroup title="服务" items={facets.service} active={filters.service} onSelect={(value) => onFilter('service', value)} />
      <FacetGroup title="事件" items={facets.event} active={filters.event} onSelect={(value) => onFilter('event', value)} />
    </aside>
  );
}
