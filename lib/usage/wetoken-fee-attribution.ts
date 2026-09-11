export type WetokenFeeAssignmentKind = 'pending' | 'user' | 'company';
export type WetokenFeeUsageKind = 'text' | 'image' | 'video';

export type WetokenFeeAttributionRow = {
  classification: 'unallocated_historical' | 'ambiguous';
  actualCostUsd: number;
  assignmentKind: WetokenFeeAssignmentKind;
};

export type WetokenFeeAttributionSummary = {
  totalCount: number;
  totalCostUsd: number;
  userCount: number;
  userCostUsd: number;
  companyCount: number;
  companyCostUsd: number;
  pendingCount: number;
  pendingCostUsd: number;
  pendingConflictCount: number;
  pendingConflictCostUsd: number;
};

export type WetokenFeeAttributionDraft = {
  assignmentKind: WetokenFeeAssignmentKind;
  userId?: string | null;
  usageKind?: WetokenFeeUsageKind | null;
  note?: string | null;
};

export type NormalizedWetokenFeeAttributionDraft = {
  assignmentKind: Exclude<WetokenFeeAssignmentKind, 'pending'>;
  userId: string | null;
  usageKind: WetokenFeeUsageKind | null;
  note: string;
};

export const MAX_WETOKEN_FEE_BATCH_ASSIGNMENTS = 100;

export type WetokenFeeSelectionResult = {
  selection: Set<string>;
  skippedCount: number;
  limitReached: boolean;
};

/**
 * Keep the interface selection aligned with the server-side batch boundary.
 * A 101st row is never selected silently and therefore can never make a
 * seemingly valid batch fail only after the administrator presses Save.
 */
export function selectWetokenFeeAttributions(current: Iterable<string>, referenceIds: Iterable<string>): WetokenFeeSelectionResult {
  const selection = new Set(current);
  let skippedCount = 0;
  for (const referenceId of referenceIds) {
    if (selection.has(referenceId)) continue;
    if (selection.size >= MAX_WETOKEN_FEE_BATCH_ASSIGNMENTS) {
      skippedCount += 1;
      continue;
    }
    selection.add(referenceId);
  }
  return { selection, skippedCount, limitReached: skippedCount > 0 };
}

export function toggleWetokenFeeAttributionSelection(current: Iterable<string>, referenceId: string): WetokenFeeSelectionResult {
  const selection = new Set(current);
  if (selection.delete(referenceId)) return { selection, skippedCount: 0, limitReached: false };
  return selectWetokenFeeAttributions(selection, [referenceId]);
}

function rounded(value: number) {
  return Number(value.toFixed(10));
}

function positive(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

/**
 * Every imported provider line belongs to exactly one bucket. This is used by
 * the administrator view so a manual historical allocation can never make a
 * WeToken invoice appear to lose or duplicate money.
 */
export function summarizeWetokenFeeAttributions(rows: WetokenFeeAttributionRow[]): WetokenFeeAttributionSummary {
  const summary: WetokenFeeAttributionSummary = {
    totalCount: 0,
    totalCostUsd: 0,
    userCount: 0,
    userCostUsd: 0,
    companyCount: 0,
    companyCostUsd: 0,
    pendingCount: 0,
    pendingCostUsd: 0,
    pendingConflictCount: 0,
    pendingConflictCostUsd: 0,
  };
  for (const row of rows) {
    const amount = positive(row.actualCostUsd);
    summary.totalCount += 1;
    summary.totalCostUsd += amount;
    if (row.assignmentKind === 'user') {
      summary.userCount += 1;
      summary.userCostUsd += amount;
      continue;
    }
    if (row.assignmentKind === 'company') {
      summary.companyCount += 1;
      summary.companyCostUsd += amount;
      continue;
    }
    summary.pendingCount += 1;
    summary.pendingCostUsd += amount;
    if (row.classification === 'ambiguous') {
      summary.pendingConflictCount += 1;
      summary.pendingConflictCostUsd += amount;
    }
  }
  for (const key of Object.keys(summary) as Array<keyof WetokenFeeAttributionSummary>) {
    if (typeof summary[key] === 'number' && key !== 'totalCount' && key !== 'userCount' && key !== 'companyCount' && key !== 'pendingCount' && key !== 'pendingConflictCount') {
      (summary[key] as number) = rounded(summary[key] as number);
    }
  }
  return summary;
}

/** Validates the explicit administrator decision before a charge is allocated. */
export function normalizeWetokenFeeAttributionDraft(input: WetokenFeeAttributionDraft): NormalizedWetokenFeeAttributionDraft {
  if (input.assignmentKind !== 'user' && input.assignmentKind !== 'company') {
    throw new Error('请选择归属用户或公司成本');
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note) throw new Error('请填写归属说明，便于后续审计');
  if (note.length > 500) throw new Error('归属说明不能超过 500 个字符');

  if (input.assignmentKind === 'company') {
    return { assignmentKind: 'company', userId: null, usageKind: null, note };
  }

  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (!userId) throw new Error('请选择归属用户');
  if (input.usageKind !== 'text' && input.usageKind !== 'image' && input.usageKind !== 'video') {
    throw new Error('请选择费用类型');
  }
  return { assignmentKind: 'user', userId, usageKind: input.usageKind, note };
}
