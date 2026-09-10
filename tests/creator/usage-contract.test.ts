import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('legacy canvas config receives the complete FG model catalog', () => {
  const store = source('reference/infinite-canvas/src/stores/use-config-store.ts');
  assert.match(store, /IMG_MODELS\.map\(\(model\) => \(\{ name: model\.id, capability: "image" as const \}\)\)/);
  assert.match(store, /VIDEO_MODELS\.map\(\(model\) => \(\{ name: model\.id, capability: "video" as const \}\)\)/);
  for (const model of [
    'gpt-5.6-luna-t1a',
    'gpt-5.6-terra-t1a',
    'claude-sonnet-5',
    'claude-opus-5',
    'deepseek-v4-pro',
  ]) {
    assert.match(store, new RegExp(`name: "${model}"`));
  }
  assert.match(store, /index === 0 \? \[\.\.\.FG_BUILTIN_MODELS/);
  assert.match(store, /models: FG_BUILTIN_MODELS\.map\(\(model\) => model\.name\)/);
});

test('creator usage API scopes ledger rows to the authenticated user', () => {
  const route = source('app/api/creator/usage/route.ts');
  assert.match(route, /localClient\.auth\.getUser\(\)/);
  assert.match(route, /\.from\('ai_usage_ledger'\)/);
  assert.match(route, /\.eq\('user_id', user\.id\)/);
  assert.match(route, /monthRangeForKey\(monthStart\)/);
  assert.match(route, /\.gte\('created_at', monthRange\.start\)/);
  assert.match(route, /\.lt\('created_at', monthRange\.end\)/);
  assert.match(route, /price_snapshot/);
  assert.match(route, /reported_cost_usd/);
  assert.match(route, /estimated_cost_usd/);
  assert.match(route, /totals/);
});

test('creator generation clients notify the in-canvas usage panel after confirmation', () => {
  const image = source('lib/creator/image-client.ts');
  const video = source('lib/creator/video-client.ts');
  const chat = source('reference/infinite-canvas/src/services/api/image.ts');
  assert.match(image, /notifyCreatorUsageUpdated\(\)/);
  assert.match(video, /notifyCreatorUsageUpdated\(\)/);
  assert.match(chat, /notifyCreatorUsageUpdated\(\)/);
  assert.match(source('components/creator/InfiniteCanvasReferenceHost.tsx'), /<CreatorUsageLedger \/>/);
  assert.match(source('components/creator/CreatorUsageLedger.tsx'), /仅显示当前账号/);
  assert.match(source('components/creator/CreatorUsageLedger.tsx'), /实际已确认/);
});
