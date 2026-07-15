import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCreatorWorkspace } from '../../lib/creator/workspace';

const workspace = {
  id: 'workspace-1',
  owner_id: 'user-1',
  name: '我的创作空间',
  settings: {},
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-15T00:00:00.000Z',
};

test('ensures then loads the authenticated user workspace', async () => {
  const calls: string[] = [];
  const client = {
    rpc: async () => {
      calls.push('rpc');
      return { data: workspace.id, error: null };
    },
    load: async (id: string) => {
      calls.push(`load:${id}`);
      return { data: workspace, error: null };
    },
  };

  assert.deepEqual(await ensureCreatorWorkspace(client, 'user-1'), workspace);
  assert.deepEqual(calls, ['rpc', `load:${workspace.id}`]);
});

test('rejects a workspace owned by another user', async () => {
  const client = {
    rpc: async () => ({ data: workspace.id, error: null }),
    load: async () => ({ data: { ...workspace, owner_id: 'user-2' }, error: null }),
  };

  await assert.rejects(
    () => ensureCreatorWorkspace(client, 'user-1'),
    /workspace ownership mismatch/,
  );
});

test('surfaces bootstrap database errors', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: 'rpc unavailable' } }),
    load: async () => ({ data: workspace, error: null }),
  };

  await assert.rejects(() => ensureCreatorWorkspace(client, 'user-1'), /rpc unavailable/);
});
