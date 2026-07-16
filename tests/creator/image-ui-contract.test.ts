import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ui = fs.readFileSync(
  path.join(process.cwd(), 'components/creator/CreatorImageWorkspace.tsx'),
  'utf8',
);
const chat = fs.readFileSync(
  path.join(process.cwd(), 'components/creator/CreatorWorkspace.tsx'),
  'utf8',
);

test('creator exposes standalone image mode with explicit confirmation', () => {
  assert.match(chat, /href="\/creator\/image"/);
  assert.match(ui, /生成 1 张/);
  assert.match(ui, /确认并生成/);
  assert.match(ui, /实际费用以 Wetoken 账单为准/);
  assert.match(ui, /最多 8 张/);
  assert.match(ui, /下载原图/);
  assert.match(ui, /复用参数/);
  assert.match(ui, /删除结果/);
});

test('history refresh is read-only and never auto-confirms a task', () => {
  assert.match(ui, /listImageTasks/);
  assert.doesNotMatch(ui, /useEffect\([\s\S]*confirmImageTask/);
});

test('standalone image workspace keeps the confirm call behind the confirmation card', () => {
  assert.match(ui, /setConfirmTarget/);
  assert.match(ui, /confirmImageTask\(confirmTarget\.id\)/);
  assert.match(ui, /confirmTarget &&/);
});


test('history deep links and the mobile controls drawer stay read-only', () => {
  assert.match(ui, /taskIdFromLocation/);
  assert.match(ui, /replaceTaskQuery/);
  assert.match(ui, /image-mobile-controls-toggle/);
  assert.match(ui, /mobile-open/);
});

test('deleting an image task does not delete usage ledger rows', () => {
  const itemRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/creator/images/[id]/route.ts'),
    'utf8',
  );
  assert.doesNotMatch(itemRoute, /ai_usage_ledger[^\n]*delete/);
});
