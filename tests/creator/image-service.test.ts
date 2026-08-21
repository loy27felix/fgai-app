import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmCreatorImage,
  CreatorImageConfirmError,
  type ConfirmImageDependencies,
  type ConfirmImageTask,
} from '../../lib/creator/image-service';
import { WetokenImageResultError } from '../../lib/ai/image';
import { persistGeneratedImage } from '../../lib/creator/image-confirm-route';

const input = { taskId: 't1', userId: 'u1', workspaceId: 'w1' };
const task: ConfirmImageTask = {
  id: 't1',
  model: 'gpt-image-2',
  request: {
    prompt: 'fox',
    effective_prompt: 'fox',
    ratio: '1:1',
    size: '1024x1024',
    reference_manifest: [],
    reference_paths: [],
    skill: null,
    uploads_complete: true,
  },
};
const generated = { bytes: new Uint8Array([1]), mimeType: 'image/png' };

function deps(overrides: Partial<ConfirmImageDependencies> = {}) {
  const events: string[] = [];
  const settlements: Array<{ status: string; error: string }> = [];
  const value: ConfirmImageDependencies = {
    claimDraft: async () => task,
    loadReferences: async () => [],
    recordAttempt: async () => { events.push('ledger'); },
    generate: async () => { events.push('provider'); return generated; },
    persistSuccess: async () => ({ assetId: 'a1', resultUrl: 'signed' }),
    settleFailure: async ({ status, error }) => { settlements.push({ status, error }); },
    ...overrides,
  };
  return { value, events, settlements };
}

test('a claimed draft records usage before one provider call', async () => {
  const { value, events } = deps();
  const result = await confirmCreatorImage(input, value);
  assert.deepEqual(events, ['ledger', 'provider']);
  assert.equal(result.assetId, 'a1');
});

test('duplicate confirmation never reaches ledger or provider', async () => {
  let calls = 0;
  const { value } = deps({
    claimDraft: async () => null,
    recordAttempt: async () => { calls += 1; },
    generate: async () => { calls += 1; return generated; },
  });
  const result = await confirmCreatorImage(input, value);
  assert.equal(result.duplicate, true);
  assert.equal(calls, 0);
});

test('free preflight failure returns the draft without a ledger or provider call', async () => {
  const { value, events, settlements } = deps({
    preflight: async () => {
      throw new CreatorImageConfirmError('INVALID_DRAFT', new Error('secret request detail'));
    },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), CreatorImageConfirmError);
  assert.deepEqual(events, []);
  assert.deepEqual(settlements, [{
    status: 'draft',
    error: '\u56fe\u7247\u4efb\u52a1\u53c2\u6570\u65e0\u6548\uff0c\u5df2\u505c\u6b62\u786e\u8ba4',
  }]);
});

test('usage ledger failure never reaches the provider and returns to draft', async () => {
  const { value, events, settlements } = deps({
    recordAttempt: async () => { throw new Error('ledger unavailable'); },
  });
  await assert.rejects(
    () => confirmCreatorImage(input, value),
    (error: unknown) => error instanceof CreatorImageConfirmError
      && error.code === 'USAGE_RECORD_FAILED'
      && !error.message.includes('ledger unavailable'),
  );
  assert.deepEqual(events, []);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].status, 'draft');
});

test('timeout settles unknown and never retries the provider', async () => {
  let calls = 0;
  const timeout = Object.assign(new Error('provider timeout'), { name: 'TimeoutError' });
  const { value, settlements } = deps({
    generate: async () => { calls += 1; throw timeout; },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), (error: unknown) => error === timeout);
  assert.equal(calls, 1);
  assert.deepEqual(settlements, [{
    status: 'unknown',
    error: '\u56fe\u7247\u751f\u6210\u8d85\u65f6\uff0c\u53ef\u80fd\u5df2\u7ecf\u4ea7\u751f\u8d39\u7528\uff0c\u8bf7\u67e5\u770b\u4efb\u52a1\u72b6\u6001',
  }]);
});

test('abort settles unknown and never retries the provider', async () => {
  let calls = 0;
  const aborted = Object.assign(new Error('request aborted'), { name: 'AbortError' });
  const { value, settlements } = deps({
    generate: async () => { calls += 1; throw aborted; },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), (error: unknown) => error === aborted);
  assert.equal(calls, 1);
  assert.equal(settlements[0].status, 'unknown');
});

test('provider failure settles failed and preserves the original error', async () => {
  const providerError = new Error('secret provider detail');
  const { value, settlements } = deps({
    generate: async () => { throw providerError; },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), (error: unknown) => error === providerError);
  assert.deepEqual(settlements, [{
    status: 'failed',
    error: '\u56fe\u7247\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  }]);
});

test('a successful provider response with no usable image preserves a safe task error', async () => {
  const providerError = new WetokenImageResultError('Gemini 返回成功，但响应中未找到可保存的图片数据');
  const { value, settlements } = deps({
    generate: async () => { throw providerError; },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), (error: unknown) => error === providerError);
  assert.deepEqual(settlements, [{
    status: 'failed',
    error: 'Gemini 返回成功，但响应中未找到可保存的图片数据',
  }]);
});

test('persist failure settles failed without reporting success', async () => {
  const { value, events, settlements } = deps({
    persistSuccess: async () => { throw new Error('asset insert failed'); },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), /asset insert failed/);
  assert.deepEqual(events, ['ledger', 'provider']);
  assert.equal(settlements[0].status, 'failed');
});

test('settle failure cannot mask the original provider error', async () => {
  const providerError = new Error('provider failed');
  const { value } = deps({
    generate: async () => { throw providerError; },
    settleFailure: async () => { throw new Error('settle failed'); },
  });
  await assert.rejects(() => confirmCreatorImage(input, value), (error: unknown) => error === providerError);
});


function persistenceTask(): ConfirmImageTask {
  return {
    ...task,
    output: {},
    request: { ...task.request },
  };
}

function fakePersistenceLocalClient(options: {
  assetResult: { data: unknown; error: unknown | null };
  taskResult: { data: unknown; error: unknown | null };
}) {
  const events: string[] = [];
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const updates: unknown[] = [];
  const bucket = {
    upload: async () => { events.push('storage.upload'); return { data: null, error: null }; },
    remove: async () => { events.push('storage.remove'); return { data: null, error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'signed' }, error: null }),
  };
  const chain = (table: string) => {
    const query = {
      insert: (_value: unknown) => {
        events.push(`${table}.insert`);
        return {
          select: (_columns: string) => ({ maybeSingle: async () => options.assetResult }),
        };
      },
      update: (value: unknown) => {
        events.push(`${table}.update`);
        updates.push({ table, value });
        const updateQuery = {
          eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return updateQuery; },
          select: (_columns: string) => ({ maybeSingle: async () => options.taskResult }),
        };
        return updateQuery;
      },
      delete: () => {
        events.push(`${table}.delete`);
        const deleteQuery = {
          eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return deleteQuery; },
          select: (_columns: string) => ({ maybeSingle: async () => ({ data: { id: 'a1' }, error: null }) }),
        };
        return deleteQuery;
      },
      select: (_columns: string) => query,
      eq: (_column: string, _value: unknown) => query,
      maybeSingle: async () => options.assetResult,
    };
    return query;
  };
  return {
    events,
    filters,
    updates,
    value: {
      storage: { from: (_bucket: string) => bucket },
      from: (table: string) => chain(table),
    },
  };
}

const persistInput = {
  task: persistenceTask(),
  requestId: 'creator-image:t1',
  generated,
  userId: 'u1',
  workspaceId: 'w1',
};

const persistedAsset = {
  id: 'a1',
  workspace_id: 'w1',
  kind: 'image',
  source: 'generation',
  name: 't1.png',
  storage_path: 'u1/image-tasks/t1/result.png',
  mime_type: 'image/png',
  width: null,
  height: null,
  duration_ms: null,
  thumbnail_path: null,
  metadata: {},
  created_at: 'now',
};

test('asset insert failure removes the exact uploaded result and never updates the task', async () => {
  const fake = fakePersistenceLocalClient({
    assetResult: { data: null, error: new Error('asset insert failed') },
    taskResult: { data: null, error: null },
  });
  await assert.rejects(
    persistGeneratedImage(fake.value as never, persistInput),
    CreatorImageConfirmError,
  );
  assert.deepEqual(fake.events, ['storage.upload', 'creator_assets.insert', 'storage.remove']);
});

test('task update error preserves the result and owner-scoped asset for reconciliation', async () => {
  const fake = fakePersistenceLocalClient({
    assetResult: { data: persistedAsset, error: null },
    taskResult: { data: null, error: new Error('task update outcome unknown') },
  });
  await assert.rejects(
    persistGeneratedImage(fake.value as never, persistInput),
    (error: unknown) => error instanceof CreatorImageConfirmError
      && error.code === 'RESULT_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(fake.events, [
    'storage.upload',
    'creator_assets.insert',
    'creator_generation_tasks.update',
  ]);
  assert.deepEqual(fake.filters, [
    { table: 'creator_generation_tasks', column: 'id', value: 't1' },
    { table: 'creator_generation_tasks', column: 'workspace_id', value: 'w1' },
    { table: 'creator_generation_tasks', column: 'user_id', value: 'u1' },
    { table: 'creator_generation_tasks', column: 'kind', value: 'image' },
    { table: 'creator_generation_tasks', column: 'status', value: 'submitting' },
  ]);
});

test('empty task update result preserves the result and asset for reconciliation', async () => {
  const fake = fakePersistenceLocalClient({
    assetResult: { data: persistedAsset, error: null },
    taskResult: { data: null, error: null },
  });
  await assert.rejects(
    persistGeneratedImage(fake.value as never, persistInput),
    (error: unknown) => error instanceof CreatorImageConfirmError
      && error.code === 'RESULT_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(fake.events, [
    'storage.upload',
    'creator_assets.insert',
    'creator_generation_tasks.update',
  ]);
  assert.deepEqual(fake.filters, [
    { table: 'creator_generation_tasks', column: 'id', value: 't1' },
    { table: 'creator_generation_tasks', column: 'workspace_id', value: 'w1' },
    { table: 'creator_generation_tasks', column: 'user_id', value: 'u1' },
    { table: 'creator_generation_tasks', column: 'kind', value: 'image' },
    { table: 'creator_generation_tasks', column: 'status', value: 'submitting' },
  ]);
});


test('ledger success write failure preserves the succeeded task and requires reconciliation', async () => {
  const fake = fakePersistenceLocalClient({
    assetResult: { data: persistedAsset, error: null },
    taskResult: { data: { id: 't1', status: 'succeeded' }, error: null },
  });
  const result = await persistGeneratedImage(
    fake.value as never,
    persistInput,
    { updateUsageStatus: async () => false },
  );
  assert.equal(result.ledgerStatus, 'unknown');
  assert.equal(result.requiresReconciliation, true);
  assert.equal(result.task && (result.task as { status: string }).status, 'succeeded');
  assert.equal(result.assetId, 'a1');
  assert.deepEqual(fake.updates[1], {
    table: 'creator_generation_tasks',
    value: { output: { ledger_status: 'unknown', requires_reconciliation: true } },
  });
  assert.deepEqual(fake.events, [
    'storage.upload',
    'creator_assets.insert',
    'creator_generation_tasks.update',
    'creator_generation_tasks.update',
  ]);
  assert.deepEqual(fake.filters, [
    { table: 'creator_generation_tasks', column: 'id', value: 't1' },
    { table: 'creator_generation_tasks', column: 'workspace_id', value: 'w1' },
    { table: 'creator_generation_tasks', column: 'user_id', value: 'u1' },
    { table: 'creator_generation_tasks', column: 'kind', value: 'image' },
    { table: 'creator_generation_tasks', column: 'status', value: 'submitting' },
    { table: 'creator_generation_tasks', column: 'id', value: 't1' },
    { table: 'creator_generation_tasks', column: 'workspace_id', value: 'w1' },
    { table: 'creator_generation_tasks', column: 'user_id', value: 'u1' },
    { table: 'creator_generation_tasks', column: 'kind', value: 'image' },
    { table: 'creator_generation_tasks', column: 'status', value: 'succeeded' },
  ]);
});

test('ledger status updater exceptions preserve the succeeded task and require reconciliation', async () => {
  const fake = fakePersistenceLocalClient({
    assetResult: { data: persistedAsset, error: null },
    taskResult: { data: { id: 't1', status: 'succeeded' }, error: null },
  });
  const result = await persistGeneratedImage(
    fake.value as never,
    persistInput,
    { updateUsageStatus: async () => { throw new Error('ledger unavailable'); } },
  );
  assert.equal(result.ledgerStatus, 'unknown');
  assert.equal(result.requiresReconciliation, true);
  assert.equal(result.task && (result.task as { status: string }).status, 'succeeded');
  assert.equal(result.assetId, 'a1');
  assert.deepEqual(fake.events, [
    'storage.upload',
    'creator_assets.insert',
    'creator_generation_tasks.update',
    'creator_generation_tasks.update',
  ]);
  assert.deepEqual(fake.filters.slice(-5), [
    { table: 'creator_generation_tasks', column: 'id', value: 't1' },
    { table: 'creator_generation_tasks', column: 'workspace_id', value: 'w1' },
    { table: 'creator_generation_tasks', column: 'user_id', value: 'u1' },
    { table: 'creator_generation_tasks', column: 'kind', value: 'image' },
    { table: 'creator_generation_tasks', column: 'status', value: 'succeeded' },
  ]);
});
