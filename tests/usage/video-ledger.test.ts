import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoLedgerEntry } from '../../lib/usage/ledger';

test('submitted video task records provider id, duration and audio intent', () => {
  const row = buildVideoLedgerEntry({
    requestId: 'wetoken-video:task-1',
    providerRequestId: 'task-1',
    userId: 'user-1',
    projectId: 'project-1',
    provider: 'wetoken',
    model: 'doubao-seedance-2-0',
    duration: 8,
    resolution: '1080p',
    generateAudio: true,
  });

  assert.equal(row.kind, 'video');
  assert.equal(row.provider_request_id, 'task-1');
  assert.equal(row.video_seconds, 8);
  assert.equal(row.generate_audio, true);
  assert.equal(row.status, 'submitted');
  assert.equal(row.cost_source, 'unknown');
});
