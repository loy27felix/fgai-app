import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('legacy canvas config receives the complete FG model catalog', () => {
  const store = source('reference/infinite-canvas/src/stores/use-config-store.ts');
  for (const model of [
    'gpt-image-2',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-image',
    'doubao-seedance-2-0',
    'doubao-seedance-2-0-filter-off',
    'doubao-seedance-2-0-fast',
    'doubao-seedance-2-0-fast-filter-off',
    'dreamina-seedance-2-0-mini',
    'dreamina-seedance-2-0-mini-filter-off',
    'dreamina-seedance-2-5',
    'dreamina-seedance-2-5-filter-off',
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
});
