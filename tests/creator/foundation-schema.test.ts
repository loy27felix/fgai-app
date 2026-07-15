import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/0003_creator_foundation.sql');

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
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql, /create or replace function public\.ensure_creator_workspace\(\)/);
  assert.match(sql, /create or replace function public\.owns_creator_workspace\(target_workspace_id uuid\)/);
  assert.match(sql, /values \('creator-assets', 'creator-assets', false\)/);
  assert.doesNotMatch(sql, /alter table public\.projects/);
  assert.doesNotMatch(sql, /alter table public\.project_members/);
});

test('all creator tables enable row level security', () => {
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
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});
