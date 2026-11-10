type Row = Record<string, unknown>;
type Read = (tool: 'logs' | 'operations' | 'detail', args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type ChainSeed = { key: 'taskId' | 'requestId' | 'traceId'; value: string };
const keys = ['taskId', 'requestId', 'traceId'] as const;
const validId = /^[A-Za-z0-9_.:-]{1,120}$/;

export function chainSeeds(rows: Row[]): ChainSeed[] {
  const seen = new Set<string>();
  return rows.flatMap(row => keys.flatMap(key => {
    const value = row[key];
    if (typeof value !== 'string' || !validId.test(value) || seen.has(`${key}:${value}`)) return [];
    seen.add(`${key}:${value}`);
    return [{ key, value }];
  }));
}

export async function traceSupportChain(seed: ChainSeed, read: Read, system: string) {
  const queue: ChainSeed[] = [seed];
  const visited = new Set<string>();
  const rows = new Map<string, Row>();
  const queries: Row[] = [];
  let truncated = false;
  let incomplete = false;
  // Expand a bounded graph of server-returned identifiers, never a model's unrelated IDs.
  // 仅展开服务端返回的定位编号，限制关联图规模，不接受模型拼出的无关链路。
  while (queue.length && visited.size < 6) {
    const next = queue.shift()!;
    const queryKey = `${next.key}:${next.value}`;
    if (visited.has(queryKey)) continue;
    visited.add(queryKey);
    // Request IDs may live in operation receipts even when HTTP logs are unavailable.
    // 请求编号也可能保存在操作回执中，不能因为HTTP日志未接入就跳过这些真实关联。
    for (const tool of ['operations', 'logs'] as const) {
      let result: Row;
      try { result = await read(tool, { [next.key]: next.value }); }
      catch { result = { rows: [], error: '链路分支查询失败，不能据此判断业务原因。' }; }
      const found = Array.isArray(result.rows) ? result.rows.filter((row): row is Row => row && typeof row === 'object'
        && (row[next.key] === next.value || (next.key === 'taskId' && row.id === next.value))) : [];
      queries.push({ tool, key: next.key, value: next.value, scope: result.scope, count: found.length,
        ...(result.note ? { note: result.note } : {}), ...(result.error ? { error: result.error } : {}), truncated: result.truncated === true, incomplete: result.incomplete === true });
      truncated ||= result.truncated === true;
      incomplete ||= result.incomplete === true || !!result.error;
      for (const row of found) {
        if (typeof row.id !== 'string') continue;
        const key = `${row.source || tool}:${row.id}`;
        rows.set(key, { ...rows.get(key), ...row, recordType: tool === 'logs' ? 'log' : 'operation' });
        if (rows.size >= 80) { truncated = true; break; }
      }
      queue.push(...chainSeeds(found).filter(item => !visited.has(`${item.key}:${item.value}`)));
    }
    if (rows.size >= 80) break;
  }
  // Pull concrete FG failure details after the owner-scoped graph lookup.
  // 先经过归属限定的链路查询，再读取FG失败节点详情，保留具体错误而非仅状态。
  if (system === 'fg') {
    const failures = [...rows.entries()].filter(([, row]) => Number(row.httpStatus) >= 400 || ['error', 'critical'].includes(String(row.level))).slice(0, 3);
    for (const [key, row] of failures) {
      try {
        const detail = await read('detail', { id: row.id });
        if (detail.id !== row.id) throw new Error('关联请求详情编号不匹配');
        rows.set(key, { ...row, ...detail });
      } catch {
        incomplete = true;
        queries.push({ tool: 'detail', id: row.id, error: '关联请求详情不可用。' });
      }
    }
  }
  const ordered = [...rows.values()].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  return { system, root: seed, rows: ordered, queries, incomplete,
    truncated: truncated || queue.some(item => !visited.has(`${item.key}:${item.value}`)),
    note: '按任务、请求与链路编号逐层展开；相同编号证明记录关联，不单独证明故障原因。未展示原始请求/响应正文。' };
}
