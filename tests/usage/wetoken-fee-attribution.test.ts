import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_WETOKEN_FEE_BATCH_ASSIGNMENTS,
  normalizeWetokenFeeAttributionDraft,
  selectWetokenFeeAttributions,
  summarizeWetokenFeeAttributions,
  toggleWetokenFeeAttributionSelection,
} from '../../lib/usage/wetoken-fee-attribution';

test('caps manual fee attribution selection at the batch processing limit', () => {
  const ninetyNine = Array.from({ length: 99 }, (_, index) => `reference-${index + 1}`);
  const batch = selectWetokenFeeAttributions(ninetyNine, ['reference-100', 'reference-101']);

  assert.equal(MAX_WETOKEN_FEE_BATCH_ASSIGNMENTS, 100);
  assert.equal(batch.selection.size, 100);
  assert.equal(batch.selection.has('reference-100'), true);
  assert.equal(batch.selection.has('reference-101'), false);
  assert.equal(batch.skippedCount, 1);

  const capped = toggleWetokenFeeAttributionSelection(batch.selection, 'reference-101');
  assert.equal(capped.selection.size, 100);
  assert.equal(capped.limitReached, true);
  assert.equal(toggleWetokenFeeAttributionSelection(batch.selection, 'reference-100').selection.size, 99);
});

test('keeps every unresolved WeToken fee in exactly one attributable ownership bucket', () => {
  const summary = summarizeWetokenFeeAttributions([
    { classification: 'unallocated_historical', actualCostUsd: 1.2, assignmentKind: 'user' },
    { classification: 'unallocated_historical', actualCostUsd: 2.3, assignmentKind: 'company' },
    { classification: 'ambiguous', actualCostUsd: 0.4, assignmentKind: 'pending' },
  ]);

  assert.deepEqual(summary, {
    totalCount: 3,
    totalCostUsd: 3.9,
    userCount: 1,
    userCostUsd: 1.2,
    companyCount: 1,
    companyCostUsd: 2.3,
    pendingCount: 1,
    pendingCostUsd: 0.4,
    pendingConflictCount: 1,
    pendingConflictCostUsd: 0.4,
  });
  assert.equal(summary.userCostUsd + summary.companyCostUsd + summary.pendingCostUsd, summary.totalCostUsd);
});

test('requires an auditable owner and note before a historical fee can leave the pending pool', () => {
  assert.throws(
    () => normalizeWetokenFeeAttributionDraft({ assignmentKind: 'user', userId: '', usageKind: 'video', note: '补记' }),
    /选择归属用户/,
  );
  assert.throws(
    () => normalizeWetokenFeeAttributionDraft({ assignmentKind: 'company', note: '' }),
    /填写归属说明/,
  );
  assert.deepEqual(
    normalizeWetokenFeeAttributionDraft({ assignmentKind: 'user', userId: 'user-1', usageKind: 'video', note: '  9 月历史视频任务  ' }),
    { assignmentKind: 'user', userId: 'user-1', usageKind: 'video', note: '9 月历史视频任务' },
  );
});
