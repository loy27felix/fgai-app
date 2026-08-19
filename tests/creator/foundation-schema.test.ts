import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.join(process.cwd(), 'docker/initdb/001-local.sql');

test('creator foundation migration defines isolated private workspace data', () => {
  assert.equal(fs.existsSync(migrationPath), true);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'creator_workspaces',
    'creator_folders',
    'creator_sessions',
    'creator_messages',
    'creator_canvases',
    'creator_assets',
    'creator_generation_tasks',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /references app_users\(id\) on delete cascade/);
  assert.match(sql, /storage_path text not null/);
  assert.doesNotMatch(sql, /alter table .* enable row level security/i);
});

test('local schema keeps creator generation tasks tied to a workspace and user', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists creator_generation_tasks/);
  assert.match(sql, /workspace_id uuid not null references creator_workspaces/);
  assert.match(sql, /user_id uuid not null references app_users/);
});
