type Row = Record<string, unknown>;
type Read = (tool: 'logs' | 'operations' | 'detail', args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type ChainSeed = { key: 'taskId' | 'requestId' | 'traceId'; value: string };
const keys = ['taskId', 'requestId', 'traceId'] as const;
const validId = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_IDENTIFIERS = 6;
const MAX_ROWS = 80;
const MAX_LOG_PAGES = 3;
const MAX_READS = 24;

export function chainSeeds(rows: Row[]): ChainSeed[] {
  const seen = new Set<string>();
  return rows.flatMap(row => [row, ...(Array.isArray(row.events)
    ? row.events.filter((event): event is Row => !!event && typeof event === 'object') : [])])
    .flatMap(row => keys.flatMap(key => {
      const value = row[key];
      if (typeof value !== 'string' || !validId.test(value) || seen.has(`${key}:${value}`)) return [];
      seen.add(`${key}:${value}`);
      return [{ key, value }];
    }));
}

export async function traceSupportChain(seed: ChainSeed, read: Read, system: string) {
  const queue: ChainSeed[] = [seed];
  const queued = new Set([`${seed.key}:${seed.value}`]);
  const visited = new Set<string>();
  const rows = new Map<string, Row>();
  const queries: Row[] = [];
  const gaps: Row[] = [];
  const truncationReasons = new Set<string>();
  let incomplete = false;
  let reads = 0;
  let rowBudgetReached = false;
  // Bounds apply to the entire root, including cursor pages, not separately to every hop.
  // 编号、记录和分页读取共享根查询预算，不能在每个关联分支重新获得预算。
  while (queue.length && visited.size < MAX_IDENTIFIERS && reads < MAX_READS && !rowBudgetReached) {
    const next = queue.shift()!;
    visited.add(`${next.key}:${next.value}`);
    for (const tool of ['operations', 'logs'] as const) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      const maxPages = tool === 'logs' ? MAX_LOG_PAGES : 1;
      for (let page = 1; page <= maxPages; page++) {
        if (reads >= MAX_READS) {
          truncationReasons.add('query_budget');
          gaps.push({ tool, ...next, reasons: ['query_budget'], nextCursor: cursor });
          break;
        }
        reads++;
        let result: Row;
        try { result = await read(tool, { [next.key]: next.value, ...(cursor ? { cursor } : {}) }); }
        catch { result = { rows: [], incomplete: true, error: '链路分支查询失败，不能据此判断业务原因。' }; }
        const found = Array.isArray(result.rows) ? result.rows.filter((row): row is Row => row && typeof row === 'object'
          && (row[next.key] === next.value || (next.key === 'taskId' && row.id === next.value))) : [];
        const pagination = result.page && typeof result.page === 'object' ? result.page as Row : undefined;
        const nextCursor = typeof pagination?.nextCursor === 'string' ? pagination.nextCursor : undefined;
        const hasMore = pagination?.hasMore === true;
        const reasons = Array.isArray(result.truncationReasons)
          ? result.truncationReasons.filter((reason): reason is string => typeof reason === 'string' && reason !== 'page_has_more') : [];
        if (result.truncated === true && !hasMore && !reasons.length) reasons.push('source_truncated');
        const metadata = Object.fromEntries(['scope', 'requestedScope', 'nativeScope', 'coverage', 'sourceCoverage', 'reason', 'limitations', 'outputTruncations', 'note', 'error']
          .filter(key => result[key] !== undefined).map(key => [key, result[key]]));
        queries.push({ tool, key: next.key, value: next.value, page, cursor, count: found.length, ...metadata,
          nextCursor, truncated: result.truncated === true, incomplete: result.incomplete === true });
        for (const reason of reasons) truncationReasons.add(reason);
        if (result.incomplete === true || result.error || reasons.length) {
          incomplete = true;
          gaps.push({ tool, ...next, page, cursor, ...metadata, reasons: reasons.length ? reasons : [result.error ? 'query_failed' : 'source_incomplete'] });
        }
        for (const row of found) {
          if (typeof row.id !== 'string') continue;
          const key = `${row.source || tool}:${row.id}`;
          if (!rows.has(key) && rows.size >= MAX_ROWS) { rowBudgetReached = true; break; }
          rows.set(key, { ...rows.get(key), ...row, recordType: tool === 'logs' ? 'log' : 'operation' });
        }
        for (const item of chainSeeds(found)) {
          const key = `${item.key}:${item.value}`;
          if (!queued.has(key)) { queued.add(key); queue.push(item); }
        }
        if (rowBudgetReached) {
          truncationReasons.add('row_budget');
          gaps.push({ tool, ...next, page, cursor, scope: result.scope, reasons: ['row_budget'], nextCursor });
          break;
        }
        if (!hasMore) break;
        const stopReason = !nextCursor ? 'missing_next_cursor' : cursors.has(nextCursor) ? 'repeated_cursor'
          : page >= maxPages ? 'page_budget' : reads >= MAX_READS ? 'query_budget' : undefined;
        if (stopReason) {
          truncationReasons.add(stopReason);
          gaps.push({ tool, ...next, page, scope: result.scope, reasons: [stopReason], nextCursor });
          break;
        }
        cursors.add(nextCursor!);
        cursor = nextCursor;
      }
      if (rowBudgetReached) break;
    }
  }
  const pending = queue.filter(item => !visited.has(`${item.key}:${item.value}`));
  if (pending.length) {
    const reason = reads >= MAX_READS ? 'query_budget' : rowBudgetReached ? 'row_budget' : 'identifier_budget';
    truncationReasons.add(reason);
    gaps.push({ reasons: [reason], pendingIdentifiers: pending });
  }
  // Only real, authorized FG log nodes have a detail endpoint; operation snapshots do not.
  // 仅为真实且已授权的 FG 日志补详情，业务状态快照没有对应日志详情接口。
  if (system === 'fg') {
    const failures = [...rows.entries()].filter(([, row]) => row.recordType === 'log'
      && (Number(row.httpStatus) >= 400 || ['error', 'critical'].includes(String(row.level))));
    if (failures.length > 3) {
      incomplete = true;
      truncationReasons.add('detail_budget');
      gaps.push({ tool: 'detail', reasons: ['detail_budget'], pendingCount: failures.length - 3 });
    }
    for (const [key, row] of failures.slice(0, 3)) {
      try {
        const detail = await read('detail', { id: row.id });
        if (detail.id !== row.id) throw new Error('关联请求详情编号不匹配');
        rows.set(key, { ...row, ...detail });
      } catch {
        incomplete = true;
        gaps.push({ tool: 'detail', id: row.id, reasons: ['detail_unavailable'] });
        queries.push({ tool: 'detail', id: row.id, error: '关联请求详情不可用。' });
      }
    }
  }
  const ordered = [...rows.values()].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const truncated = truncationReasons.size > 0;
  return { system, root: seed, rows: ordered, linkedIdentifiers: chainSeeds(ordered), queries, gaps, incomplete: incomplete || truncated,
    truncated, truncationReasons: [...truncationReasons], budget: { identifiers: MAX_IDENTIFIERS, rows: MAX_ROWS, logPages: MAX_LOG_PAGES, reads: MAX_READS, detailReads: 3 },
    note: '按任务、请求与链路编号逐层展开；每个日志分支有限续页，实际范围及缺口见 queries/gaps。相同编号证明记录关联，不单独证明故障原因；未截断也不证明未采集的历史完整。未展示原始请求/响应正文。' };
}
