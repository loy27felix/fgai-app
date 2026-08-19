import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('local usage ledger keeps user ownership and query indexes', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'docker/initdb/001-local.sql'), 'utf8');
  assert.match(sql, /create table if not exists ai_usage_ledger/);
  assert.match(sql, /user_id uuid not null references app_users/);
  assert.match(sql, /create index if not exists usage_ledger_user_idx on ai_usage_ledger\(user_id/);
});
