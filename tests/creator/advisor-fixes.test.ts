import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0007_creator_advisor_fixes.sql'),
  'utf8',
);

test('workspace bootstrap runs with caller RLS privileges', () => {
  assert.match(
    sql,
    /alter function public\.ensure_creator_workspace\(\) security invoker/,
  );
});

test('creator foreign keys have covering indexes', () => {
  const indexes = [
    'ai_usage_ledger_creator_task_idx',
    'creator_assets_session_workspace_idx',
    'creator_canvases_folder_workspace_idx',
    'creator_canvases_session_workspace_idx',
    'creator_folders_workspace_idx',
    'creator_tasks_canvas_workspace_idx',
    'creator_tasks_session_workspace_idx',
    'creator_tasks_user_idx',
    'creator_sessions_folder_workspace_idx',
  ];

  for (const index of indexes) {
    assert.match(sql, new RegExp(`create index if not exists ${index}`));
  }
});
