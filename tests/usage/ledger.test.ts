import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreatorImageLedgerEntry,
  buildImageLedgerEntry,
  buildTextLedgerEntry,
  recordUsageBestEffort,
  recordUsageRequired,
  updateImageUsageStatus,
  type UsageLedgerStatus,
} from '../../lib/usage/ledger';

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

test('creator image attempts start submitted and link the task', () => {
  const row = buildCreatorImageLedgerEntry({
    requestId: 'req-image',
    userId: 'u1',
    workspaceId: 'w1',
    creatorTaskId: 't1',
    model: 'gpt-image-2',
    resolution: '1536x864',
  });

  assert.deepEqual(row, {
    request_id: 'req-image',
    user_id: 'u1',
    workspace_id: 'w1',
    project_id: null,
    creator_task_id: 't1',
    kind: 'image',
    provider: 'wetoken',
    model: 'gpt-image-2',
    image_count: 1,
    resolution: '1536x864',
    cost_source: 'unknown',
    price_snapshot: {},
    status: 'submitted',
    possibly_charged: true,
  });
});

test('required usage writer throws when persistence returns an error', async () => {
  const row = buildCreatorImageLedgerEntry({
    requestId: 'r',
    userId: 'u',
    workspaceId: 'w',
    creatorTaskId: 't',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });

  await assert.rejects(
    () => recordUsageRequired(row, {
      upsert: async () => ({ error: new Error('down') }),
    }),
    /\u7528\u91cf\u8bb0\u5f55\u5199\u5165\u5931\u8d25/,
  );
});

test('required usage writer propagates a thrown persistence failure', async () => {
  const row = buildCreatorImageLedgerEntry({
    requestId: 'r-thrown',
    userId: 'u',
    workspaceId: 'w',
    creatorTaskId: 't',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });

  await assert.rejects(
    () => recordUsageRequired(row, {
      upsert: async () => { throw new Error('database unavailable'); },
    }),
    /database unavailable/,
  );
});

test('required usage writer uses the injected writer and request_id conflict key', async () => {
  const row = buildCreatorImageLedgerEntry({
    requestId: 'r-injected',
    userId: 'u',
    workspaceId: 'w',
    creatorTaskId: 't',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });
  const calls: Array<{ row: unknown; options: unknown }> = [];

  await recordUsageRequired(row, {
    upsert: async (savedRow, options) => {
      calls.push({ row: savedRow, options });
      return { error: null };
    },
  });

  assert.deepEqual(calls, [{ row, options: { onConflict: 'request_id' } }]);
});

test('required usage writer accepts only explicit persistence errors as failure', async () => {
  const row = buildCreatorImageLedgerEntry({
    requestId: 'r-success-shapes',
    userId: 'u',
    workspaceId: 'w',
    creatorTaskId: 't',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });

  for (const result of [{ error: null }, { error: undefined }, null, undefined]) {
    await assert.doesNotReject(() => recordUsageRequired(row, {
      upsert: async () => result,
    }));
  }
});

test('image status updates use the injected dependency and complete the request', async () => {
  const calls: Array<{ values: object; requestId: string }> = [];

  const saved = await updateImageUsageStatus({
    requestId: 'r-status',
    status: 'succeeded',
    completedAt: '2026-07-15T00:00:00.000Z',
  }, {
    update: async (values, requestId) => {
      calls.push({ values, requestId });
      return { data: { request_id: requestId }, error: null };
    },
  });

  assert.equal(saved, true);
  assert.deepEqual(calls, [{
    values: {
      status: 'succeeded',
      completed_at: '2026-07-15T00:00:00.000Z',
    },
    requestId: 'r-status',
  }]);
});

test('image status updates require a returned ledger row', async () => {
  const statuses: UsageLedgerStatus[] = ['submitted', 'succeeded', 'failed', 'unknown'];

  for (const result of [{ data: null, error: null }, { data: [], error: null }, { error: null }, null, undefined]) {
    assert.equal(await updateImageUsageStatus({
      requestId: 'r-status-empty',
      status: statuses[3],
    }, {
      update: async () => result,
    }), false);
  }

  assert.equal(await updateImageUsageStatus({
    requestId: 'r-status-row',
    status: statuses[1],
  }, {
    update: async (_values, requestId) => ({ data: { request_id: requestId }, error: null }),
  }), true);

  assert.equal(await updateImageUsageStatus({
    requestId: 'r-status-failure',
    status: statuses[2],
  }, {
    update: async () => ({ data: null, error: new Error('down') }),
  }), false);
});

test('image status updates convert dependency exceptions to false', async () => {
  assert.equal(await updateImageUsageStatus({
    requestId: 'r-status-throw',
    status: 'unknown',
  }, {
    update: async () => { throw new Error('ledger unavailable'); },
  }), false);
});

test('legacy director image entries remain succeeded and unrelated to creator tasks', () => {
  const row = buildImageLedgerEntry({
    requestId: 'legacy-image',
    userId: 'u',
    provider: 'wetoken',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });

  assert.equal(row.creator_task_id, null);
  assert.equal(row.status, 'succeeded');
});
