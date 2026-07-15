import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('usage ledger uses one authenticated read policy', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0006_creator_advisor_fixes.sql'),
    'utf8',
  );

  assert.match(sql, /drop policy if exists "usage ledger self read"/);
  assert.match(sql, /drop policy if exists "usage ledger admin read"/);
  assert.match(sql, /create policy "usage ledger authorized read"/);
  assert.match(sql, /for select\s+to authenticated/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)\s+or public\.is_admin\(\)/);
});
