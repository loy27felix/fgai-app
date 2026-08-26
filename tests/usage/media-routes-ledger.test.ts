import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('image successes and video submissions write the trusted usage ledger', () => {
  const imageRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/ai/image/route.ts'),
    'utf8',
  );
  const videoRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/ai/video/route.ts'),
    'utf8',
  );

  assert.match(imageRoute, /buildImageLedgerEntry/);
  assert.match(imageRoute, /recordUsageBestEffort/);
  assert.match(videoRoute, /buildVideoLedgerEntry/);
  assert.match(videoRoute, /providerRequestId:\s*pendingExternalTaskId/);
  assert.match(videoRoute, /recordUsageRequired\(pendingLedgerEntry\)/);
  assert.match(videoRoute, /providerRequestId:\s*created\.externalTaskId/);
  assert.match(videoRoute, /updateVideoUsageBestEffort/);
});
