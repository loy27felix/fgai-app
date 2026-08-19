import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sql = fs.readFileSync(path.join(process.cwd(), 'docker/initdb/001-local.sql'), 'utf8');

test('local bootstrap creates project ownership in PostgreSQL', () => {
  assert.match(sql, /create or replace function add_project_owner\(\)/);
  assert.match(sql, /create trigger projects_add_owner after insert on projects/);
});

test('creator foreign keys have covering indexes', () => {
  const indexes = [
    'creator_assets_workspace_idx',
    'creator_tasks_workspace_idx',
    'usage_ledger_user_idx',
  ];

  for (const index of indexes) {
    assert.match(sql, new RegExp(`create index if not exists ${index}`));
  }
});
