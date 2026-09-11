import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveWetokenFeeEntry,
  summarizeWetokenFeeResolutions,
} from '../../lib/usage/wetoken-fee-reconciliation';

const entry = {
  referenceId: 'cgt-20260911110940-8k6ww',
  model: 'doubao-seedance-2-0',
  occurredAt: '2026-09-11 11:13:50',
  actualCostUsd: 1.933156,
};

test('settles a WeToken fee line to its one exact ledger Reference ID', () => {
  const resolution = resolveWetokenFeeEntry(entry, {
    ledgerByReference: new Map([[entry.referenceId, [{ id: 'ledger-1', providerRequestId: entry.referenceId }]]]),
    creatorTasksByReference: new Map(),
    creatorLedgersByTaskId: new Map(),
    projectTasksByReference: new Map(),
  });

  assert.equal(resolution.state, 'ledger_matched');
  const summary = summarizeWetokenFeeResolutions([resolution]);
  assert.deepEqual(summary, {
    totalCount: 1,
    totalCostUsd: 1.933156,
    ledgerMatchedCount: 1,
    ledgerMatchedCostUsd: 1.933156,
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
  });
});

test('recovers an older creator task when its ledger was saved before the provider task ID', () => {
  const resolution = resolveWetokenFeeEntry(entry, {
    ledgerByReference: new Map(),
    creatorTasksByReference: new Map([[entry.referenceId, [{
      id: 'creator-task-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      kind: 'image',
      provider: 'wetoken',
      model: entry.model,
      status: 'succeeded',
      request: {},
      createdAt: entry.occurredAt,
    }]]]),
    creatorLedgersByTaskId: new Map([['creator-task-1', [{ id: 'ledger-1', providerRequestId: null }]]]),
    projectTasksByReference: new Map(),
  });

  assert.equal(resolution.state, 'creator_ledger_recovered');
  const summary = summarizeWetokenFeeResolutions([resolution]);
  assert.equal(summary.creatorRecoveredCount, 1);
  assert.equal(summary.creatorRecoveredCostUsd, entry.actualCostUsd);
  assert.equal(summary.unallocatedCostUsd, 0);
});

test('keeps a provider charge without any local task visible as unallocated instead of assigning it by model or time', () => {
  const resolution = resolveWetokenFeeEntry(entry, {
    ledgerByReference: new Map(),
    creatorTasksByReference: new Map(),
    creatorLedgersByTaskId: new Map(),
    projectTasksByReference: new Map(),
  });

  assert.equal(resolution.state, 'unallocated_historical');
  const summary = summarizeWetokenFeeResolutions([resolution]);
  assert.equal(summary.totalCostUsd, entry.actualCostUsd);
  assert.equal(summary.ledgerMatchedCostUsd + summary.creatorRecoveredCostUsd + summary.projectRecoveredCostUsd + summary.unallocatedCostUsd + summary.ambiguousCostUsd, entry.actualCostUsd);
  assert.deepEqual(summary.unallocatedByModel, [{ model: entry.model, count: 1, actualCostUsd: entry.actualCostUsd }]);
});

test('leaves conflicting exact task IDs outside user totals and reports the conflict amount', () => {
  const resolution = resolveWetokenFeeEntry(entry, {
    ledgerByReference: new Map([[entry.referenceId, [
      { id: 'ledger-1', providerRequestId: entry.referenceId },
      { id: 'ledger-2', providerRequestId: entry.referenceId },
    ]]]),
    creatorTasksByReference: new Map(),
    creatorLedgersByTaskId: new Map(),
    projectTasksByReference: new Map(),
  });

  assert.equal(resolution.state, 'ambiguous');
  const summary = summarizeWetokenFeeResolutions([resolution]);
  assert.equal(summary.ambiguousCostUsd, entry.actualCostUsd);
  assert.equal(summary.ledgerMatchedCostUsd, 0);
  assert.deepEqual(summary.ambiguousByModel, [{ model: entry.model, count: 1, actualCostUsd: entry.actualCostUsd }]);
});
