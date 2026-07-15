import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeVideoLedgerStatus } from '../../lib/usage/ledger';

test('video provider statuses map to ledger-safe terminal states', () => {
  assert.equal(normalizeVideoLedgerStatus('queued'), 'submitted');
  assert.equal(normalizeVideoLedgerStatus('running'), 'submitted');
  assert.equal(normalizeVideoLedgerStatus('succeeded'), 'succeeded');
  assert.equal(normalizeVideoLedgerStatus('failed'), 'failed');
  assert.equal(normalizeVideoLedgerStatus('expired'), 'failed');
});

test('video polling synchronizes the trusted ledger status', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/ai/video/[id]/route.ts'),
    'utf8',
  );
  assert.match(route, /updateVideoUsageBestEffort/);
  assert.match(route, /wetoken-video:/);
});
