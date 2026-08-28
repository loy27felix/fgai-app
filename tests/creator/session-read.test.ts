import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCreatorMessages, normalizeCreatorSessions } from '../../lib/creator/session-read';

test('normalizes Postgres Date timestamps so a refreshed local chat remains visible', () => {
  const sessions = normalizeCreatorSessions([
    {
      id: 'older', workspace_id: 'workspace-1', kind: 'chat', title: '旧对话',
      created_at: new Date('2026-08-28T02:00:00.000Z'), updated_at: new Date('2026-08-28T02:00:00.000Z'),
    },
    {
      id: 'latest', workspace_id: 'workspace-1', kind: 'chat', title: '新对话',
      created_at: new Date('2026-08-28T03:00:00.000Z'), updated_at: new Date('2026-08-28T04:00:00.000Z'),
    },
  ], 'chat');

  assert.deepEqual(sessions.map((session) => session.id), ['latest', 'older']);
  assert.equal(sessions[0].updated_at, '2026-08-28T04:00:00.000Z');
  assert.equal(sessions[1].created_at, '2026-08-28T02:00:00.000Z');
});

test('normalizes Postgres Date timestamps for persisted creator messages', () => {
  const messages = normalizeCreatorMessages([
    { id: 'message-1', session_id: 'session-1', role: 'user', content: { text: '保留我' }, created_at: new Date('2026-08-28T04:00:00.000Z') },
  ]);

  assert.equal(messages[0].created_at, '2026-08-28T04:00:00.000Z');
});
