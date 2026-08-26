import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');

test('creator session history failures stay traceable and recoverable', () => {
  const sessionsRoute = source('app', 'api', 'creator', 'sessions', 'route.ts');
  const chatPage = source('app', 'chat', 'page.tsx');
  const workspace = source('components', 'creator', 'CreatorWorkspace.tsx');
  const agent = source('reference', 'infinite-canvas', 'src', 'components', 'agent', 'local-agent-panel.tsx');

  assert.match(sessionsRoute, /requestTraceId/);
  assert.match(sessionsRoute, /action: 'read'/);
  assert.match(sessionsRoute, /attachTraceId/);
  assert.match(chatPage, /initialLoadError/);
  assert.match(workspace, /reloadHistory/);
  assert.match(workspace, /重新读取/);
  assert.match(agent, /fg-agent-retry/);
  assert.match(agent, /cache: "no-store"/);
});

test('local upgrades include durable creator session schema', () => {
  const migration = source('docker', 'initdb', '002-local-upgrade.sql');

  assert.match(migration, /create table if not exists creator_sessions/i);
  assert.match(migration, /create table if not exists creator_messages/i);
  // `CREATE TABLE IF NOT EXISTS` is a no-op when an existing local volume
  // contains an earlier table shape. The live read path filters and orders on
  // these fields, so the upgrade must add them to pre-existing tables too.
  assert.match(migration, /alter table if exists creator_sessions[\s\S]*add column if not exists kind/i);
  assert.match(migration, /alter table if exists creator_sessions[\s\S]*add column if not exists archived_at/i);
  assert.match(migration, /alter table if exists creator_sessions[\s\S]*add column if not exists updated_at/i);
  assert.match(migration, /alter table if exists creator_messages[\s\S]*add column if not exists content/i);
  assert.match(migration, /update creator_sessions[\s\S]*set\s+kind = coalesce/i);
  assert.match(migration, /creator_sessions_workspace_kind_updated_idx/);
});

test('local database query errors retain PostgreSQL diagnostics for trace logs', () => {
  const localDb = source('lib', 'local', 'db.ts');
  const localTypes = source('lib', 'local', 'types.ts');

  assert.match(localDb, /function toLocalDatabaseError/);
  assert.match(localDb, /code: optionalText\("code"\)/);
  assert.match(localDb, /return \{ data: null, error: toLocalDatabaseError\(error\) \}/);
  assert.match(localTypes, /export type LocalDatabaseError/);
  assert.match(localTypes, /detail\?: string/);
});
