import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('a conversation can be permanently deleted only after confirmation', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/creator/sessions/route.ts'), 'utf8');
  const ui = fs.readFileSync(path.join(process.cwd(), 'components/creator/CreatorWorkspace.tsx'), 'utf8');

  assert.match(route, /export async function DELETE/);
  assert.match(route, /\.delete\(\)/);
  assert.match(route, /\.eq\('workspace_id', context\.workspace\.id\)/);
  assert.match(ui, /method:\s*["']DELETE["']/);
  assert.match(ui, /删除对话/);
  assert.match(ui, /此操作无法撤销/);
});
