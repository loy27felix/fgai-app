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
  assert.match(migration, /creator_sessions_workspace_kind_updated_idx/);
});
