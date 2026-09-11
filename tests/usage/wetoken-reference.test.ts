import assert from 'node:assert/strict';
import test from 'node:test';
import {
  wetokenReferenceIdsFromPersistedTask,
  wetokenReferenceIdsFromProviderDiagnostic,
} from '../../lib/usage/wetoken-reference';

test('keeps an exact WeToken Reference ID from the successful image response', () => {
  assert.deepEqual(
    wetokenReferenceIdsFromProviderDiagnostic({ reference_id: 'wt-image-123' }),
    ['wt-image-123'],
  );
});

test('recovers only persisted exact IDs from Creator task output', () => {
  assert.deepEqual(
    wetokenReferenceIdsFromPersistedTask({
      external_task_id: 'wt-video-001',
      output: {
        wetoken_reference_id: 'wt-image-123',
        provider_diagnostic: { requestId: 'wt-image-123' },
      },
    }),
    ['wt-video-001', 'wt-image-123'],
  );
});

test('never turns empty or malformed diagnostic values into a fee reference', () => {
  assert.deepEqual(
    wetokenReferenceIdsFromPersistedTask({
      output: {
        wetoken_reference_id: '   ',
        provider_diagnostic: { requestId: 42, reference_id: 'x'.repeat(513) },
      },
    }),
    [],
  );
});
