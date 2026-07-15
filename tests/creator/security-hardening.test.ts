import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/0005_creator_security_hardening.sql',
);

test('creator security hardening scopes policies and function execution', () => {
  assert.equal(fs.existsSync(migrationPath), true);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /revoke execute on function public\.ensure_creator_workspace\(\) from public, anon/);
  assert.match(sql, /revoke execute on function public\.owns_creator_workspace\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.ensure_creator_workspace\(\) to authenticated/);
  assert.match(sql, /for all to authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.creator_workspaces to authenticated/);
  assert.match(sql, /grant select on public\.ai_usage_ledger to authenticated/);
});
