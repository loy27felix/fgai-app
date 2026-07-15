import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextLedgerEntry, recordUsageBestEffort } from '../../lib/usage/ledger';

test('maps text model usage into an unknown-cost ledger entry', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-1',
    userId: 'user-1',
    projectId: null,
    provider: 'wetoken',
    model: 'gpt-5.6-luna',
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  });

  assert.deepEqual(row, {
    request_id: 'req-1',
    user_id: 'user-1',
    workspace_id: null,
    project_id: null,
    creator_task_id: null,
    kind: 'text',
    provider: 'wetoken',
    model: 'gpt-5.6-luna',
    input_tokens: 12,
    output_tokens: 8,
    total_tokens: 20,
    cost_source: 'unknown',
    price_snapshot: {},
    status: 'succeeded',
    possibly_charged: true,
  });
});

test('best-effort ledger persistence never hides a successful model response', async () => {
  const saved = await recordUsageBestEffort(
    buildTextLedgerEntry({
      requestId: 'req-1',
      userId: 'user-1',
      provider: 'wetoken',
      model: 'gpt-5.6-luna',
      usage: undefined,
    }),
    { upsert: async () => { throw new Error('database unavailable'); } },
  );
  assert.equal(saved, false);
});

test('DeepSeek text usage keeps its provider identity', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-deepseek',
    userId: 'user-1',
    provider: 'deepseek',
    model: 'deepseek-flash',
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  });
  assert.equal(row.provider, 'deepseek');
  assert.equal(row.total_tokens, 3);
});
