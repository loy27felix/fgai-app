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
  assert.match(imageRoute, /requireProviderUsageReference/);
  assert.match(imageRoute, /recordUsageRequired/);
  assert.doesNotMatch(imageRoute, /recordUsageBestEffort/);
  assert.match(videoRoute, /buildVideoLedgerEntry/);
  assert.match(videoRoute, /providerRequestId:\s*pendingExternalTaskId/);
  assert.match(videoRoute, /recordUsageRequired\(pendingLedgerEntry\)/);
  assert.match(videoRoute, /providerRequestId:\s*created\.externalTaskId/);
  assert.match(videoRoute, /updateVideoUsageBestEffort/);
});

test('every WeToken text response is durably linked to its provider Reference ID before completion', () => {
  const routes = [
    'app/api/ai/chat/route.ts',
    'app/api/creator/chat/route.ts',
    'app/api/creator/canvas-agent/video-plan/route.ts',
  ].map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8'));

  for (const route of routes) {
    assert.match(route, /requireProviderUsageReference/);
    assert.match(route, /recordUsageRequired/);
    assert.doesNotMatch(route, /recordUsageBestEffort/);
  }
});
