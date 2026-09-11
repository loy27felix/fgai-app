import type { WetokenFeeLogEntry } from './wetoken-fee-log';

export type FeeLedgerMatch = {
  id: string;
  providerRequestId?: string | null;
  creatorTaskId?: string | null;
};

export type FeeCreatorTaskMatch = {
  id: string;
  userId: string;
  workspaceId: string | null;
  kind: string;
  provider: string;
  model: string;
  status: string;
  request: Record<string, unknown>;
  createdAt: string;
};

export type FeeProjectTaskMatch = {
  id: string;
  userId: string;
  projectId: string | null;
  kind: string;
  provider: string;
  model: string;
  status: string;
  request: Record<string, unknown>;
  createdAt: string;
};

export type WetokenFeeResolution =
  | { state: 'ledger_matched'; entry: WetokenFeeLogEntry; ledger: FeeLedgerMatch }
  | { state: 'creator_ledger_recovered'; entry: WetokenFeeLogEntry; ledger: FeeLedgerMatch; task: FeeCreatorTaskMatch }
  | { state: 'creator_task_recovered'; entry: WetokenFeeLogEntry; task: FeeCreatorTaskMatch }
  | { state: 'project_task_recovered'; entry: WetokenFeeLogEntry; task: FeeProjectTaskMatch }
  | { state: 'unallocated_historical'; entry: WetokenFeeLogEntry }
  | { state: 'ambiguous'; entry: WetokenFeeLogEntry; reason: string };

export type WetokenFeeReconciliationSources = {
  ledgerByReference: Map<string, FeeLedgerMatch[]>;
  creatorTasksByReference: Map<string, FeeCreatorTaskMatch[]>;
  creatorLedgersByTaskId: Map<string, FeeLedgerMatch[]>;
  projectTasksByReference: Map<string, FeeProjectTaskMatch[]>;
};

/**
 * Reconcile only through a provider Reference ID or a locally persisted task
 * that owns that exact same ID. Model/time heuristics would make one person's
 * real charge appear in another person's history, so they are intentionally
 * not used here.
 */
export function resolveWetokenFeeEntry(
  entry: WetokenFeeLogEntry,
  sources: WetokenFeeReconciliationSources,
): WetokenFeeResolution {
  const ledgerRows = sources.ledgerByReference.get(entry.referenceId) || [];
  if (ledgerRows.length === 1) return { state: 'ledger_matched', entry, ledger: ledgerRows[0] };
  if (ledgerRows.length > 1) return { state: 'ambiguous', entry, reason: '同一 Reference ID 对应多条本地账本记录' };

  const creatorTasks = sources.creatorTasksByReference.get(entry.referenceId) || [];
  const projectTasks = sources.projectTasksByReference.get(entry.referenceId) || [];
  if (creatorTasks.length > 1 || projectTasks.length > 1 || (creatorTasks.length && projectTasks.length)) {
    return { state: 'ambiguous', entry, reason: '同一 Reference ID 对应多个本地任务' };
  }

  if (creatorTasks.length === 1) {
    const task = creatorTasks[0];
    const taskLedgers = sources.creatorLedgersByTaskId.get(task.id) || [];
    if (taskLedgers.length === 1) {
      const ledger = taskLedgers[0];
      if (ledger.providerRequestId && ledger.providerRequestId !== entry.referenceId) {
        return { state: 'ambiguous', entry, reason: '本地任务账本已绑定到另一个 Reference ID' };
      }
      return { state: 'creator_ledger_recovered', entry, ledger, task };
    }
    if (taskLedgers.length > 1) return { state: 'ambiguous', entry, reason: '本地任务对应多条账本记录' };
    return { state: 'creator_task_recovered', entry, task };
  }

  if (projectTasks.length === 1) return { state: 'project_task_recovered', entry, task: projectTasks[0] };
  return { state: 'unallocated_historical', entry };
}

export type FeeReconciliationSummary = {
  totalCount: number;
  totalCostUsd: number;
  ledgerMatchedCount: number;
  ledgerMatchedCostUsd: number;
  creatorRecoveredCount: number;
  creatorRecoveredCostUsd: number;
  projectRecoveredCount: number;
  projectRecoveredCostUsd: number;
  unallocatedCount: number;
  unallocatedCostUsd: number;
  ambiguousCount: number;
  ambiguousCostUsd: number;
  unallocatedByModel: Array<{ model: string; count: number; actualCostUsd: number }>;
  ambiguousByModel: Array<{ model: string; count: number; actualCostUsd: number }>;
};

function rounded(value: number) {
  return Number(value.toFixed(10));
}

function modelTotals(resolutions: WetokenFeeResolution[], state: 'unallocated_historical' | 'ambiguous') {
  const totals = new Map<string, { model: string; count: number; actualCostUsd: number }>();
  for (const resolution of resolutions) {
    if (resolution.state !== state) continue;
    const model = resolution.entry.model || '未提供模型名';
    const current = totals.get(model) || { model, count: 0, actualCostUsd: 0 };
    current.count += 1;
    current.actualCostUsd += resolution.entry.actualCostUsd;
    totals.set(model, current);
  }
  return [...totals.values()]
    .map((row) => ({ ...row, actualCostUsd: rounded(row.actualCostUsd) }))
    .sort((left, right) => right.actualCostUsd - left.actualCostUsd || right.count - left.count || left.model.localeCompare(right.model));
}

export function summarizeWetokenFeeResolutions(resolutions: WetokenFeeResolution[]): FeeReconciliationSummary {
  const summary: FeeReconciliationSummary = {
    totalCount: resolutions.length,
    totalCostUsd: 0,
    ledgerMatchedCount: 0,
    ledgerMatchedCostUsd: 0,
    creatorRecoveredCount: 0,
    creatorRecoveredCostUsd: 0,
    projectRecoveredCount: 0,
    projectRecoveredCostUsd: 0,
    unallocatedCount: 0,
    unallocatedCostUsd: 0,
    ambiguousCount: 0,
    ambiguousCostUsd: 0,
    unallocatedByModel: [],
    ambiguousByModel: [],
  };
  for (const resolution of resolutions) {
    const amount = resolution.entry.actualCostUsd;
    summary.totalCostUsd += amount;
    if (resolution.state === 'ledger_matched') {
      summary.ledgerMatchedCount += 1;
      summary.ledgerMatchedCostUsd += amount;
    } else if (resolution.state === 'creator_ledger_recovered' || resolution.state === 'creator_task_recovered') {
      summary.creatorRecoveredCount += 1;
      summary.creatorRecoveredCostUsd += amount;
    } else if (resolution.state === 'project_task_recovered') {
      summary.projectRecoveredCount += 1;
      summary.projectRecoveredCostUsd += amount;
    } else if (resolution.state === 'unallocated_historical') {
      summary.unallocatedCount += 1;
      summary.unallocatedCostUsd += amount;
    } else {
      summary.ambiguousCount += 1;
      summary.ambiguousCostUsd += amount;
    }
  }
  for (const key of Object.keys(summary) as Array<keyof FeeReconciliationSummary>) {
    if (typeof summary[key] === 'number') (summary[key] as number) = rounded(summary[key] as number);
  }
  summary.unallocatedByModel = modelTotals(resolutions, 'unallocated_historical');
  summary.ambiguousByModel = modelTotals(resolutions, 'ambiguous');
  return summary;
}
