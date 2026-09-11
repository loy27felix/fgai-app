/** A successful WeToken fee-log consumption row, normalized for ledger settlement. */
export type WetokenFeeLogEntry = {
  referenceId: string;
  model: string;
  occurredAt: string;
  /** The discounted actual cost shown by WeToken, stored as an absolute USD amount. */
  actualCostUsd: number;
};

type CsvRecord = Record<string, string>;

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function headerKey(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-()[\]]/g, '');
}

function valueFor(record: CsvRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberFromMoney(value: string) {
  const normalized = value.replace(/[,$¥￥\s]/g, '');
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function isConsume(value: string) {
  return ['consume', '消费'].includes(value.trim().toLowerCase());
}

function isSuccess(value: string) {
  return ['success', '成功'].includes(value.trim().toLowerCase());
}

/**
 * Parses both WeToken expense exports:
 *
 * - the Console's fee-log export (Type / Status / Cost; consumption is
 *   represented as a negative amount); and
 * - the account export (Actual Amount (USD), without Type / Status; top-ups
 *   have no model name and must never be charged to a studio user).
 *
 * The trusted ledger always stores the absolute, discounted USD consumption
 * amount and presents it in RMB at the product layer.
 */
export function parseWetokenFeeLogCsv(input: string): WetokenFeeLogEntry[] {
  const rows = parseCsv(input);
  const [headers, ...data] = rows;
  if (!headers?.length) throw new Error('WeToken 费用 CSV 为空');
  const fields = headers.map(headerKey);
  const typeKeys = ['type', '类型'];
  const statusKeys = ['status', '状态'];
  const modelKeys = ['modelname', '模型名称'];
  const hasType = typeKeys.some((choice) => fields.includes(choice));
  const hasStatus = statusKeys.some((choice) => fields.includes(choice));
  const required = [
    ['referenceid', '流水标识'],
    ['actualamountusd', 'actualamount', 'cost', '费用'],
  ];
  if (required.some((choices) => !choices.some((choice) => fields.includes(choice)))) {
    throw new Error('无法识别 WeToken 费用 CSV 表头。请从“费用流水 → 导出 CSV”重新导出后上传。');
  }
  if (hasType !== hasStatus) {
    throw new Error('WeToken 费用 CSV 缺少完整的类型或状态字段。请重新导出后上传。');
  }

  const result: WetokenFeeLogEntry[] = [];
  for (const cells of data) {
    const record = Object.fromEntries(fields.map((field, index) => [field, cells[index] || '']));
    const type = valueFor(record, typeKeys);
    const status = valueFor(record, statusKeys);
    const model = valueFor(record, modelKeys);
    if (hasType && (!isConsume(type) || !isSuccess(status))) continue;
    // Account-level exports omit Type/Status. Top-ups and adjustments have no
    // model name, while generated model calls always do, so exclude them.
    if (!hasType && !model) continue;
    const referenceId = valueFor(record, ['referenceid', '流水标识']);
    const actualCostUsd = numberFromMoney(valueFor(record, ['actualamountusd', 'actualamount', 'cost', '费用']));
    if (!referenceId || actualCostUsd === null) continue;
    result.push({
      referenceId,
      model,
      occurredAt: valueFor(record, ['time', '时间']),
      actualCostUsd,
    });
  }
  return result;
}
