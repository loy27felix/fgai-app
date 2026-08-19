import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createImageItemHandlers } from '../../lib/creator/image-item-route';
import { createImageConfirmHandlers } from '../../lib/creator/image-confirm-route';
import { ImageStorageError } from '../../lib/creator/imageStorage';
import { CreatorImageConfirmError } from '../../lib/creator/image-service';
import { WetokenImageRequestError } from '../../lib/ai/image';
import {
  assertOwnedResultPath,
  normalizeImageIdempotencyKey,
  scopedImageIdempotencyKey,
  validateCompletedReferencePaths,
} from '../../lib/creator/image';

const collectionPath = path.join(process.cwd(), 'app/api/creator/images/route.ts');
const itemPath = path.join(process.cwd(), 'app/api/creator/images/[id]/route.ts');
const confirmRoutePath = path.join(process.cwd(), 'app/api/creator/images/[id]/confirm/route.ts');
const storagePath = path.join(process.cwd(), 'lib/creator/imageStorage.ts');
const itemHandlerPath = path.join(process.cwd(), 'lib/creator/image-item-route.ts');
const confirmHandlerPath = path.join(process.cwd(), 'lib/creator/image-confirm-route.ts');
const collection = fs.readFileSync(collectionPath, 'utf8');
const item = fs.readFileSync(itemPath, 'utf8') + fs.readFileSync(itemHandlerPath, 'utf8');
const confirmRoute = fs.readFileSync(confirmRoutePath, 'utf8') + fs.readFileSync(confirmHandlerPath, 'utf8');
const storageService = fs.readFileSync(storagePath, 'utf8');

test('all creator image operations authenticate and bootstrap the private workspace', () => {
  assert.match(collection, /export async function GET/);
  assert.match(collection, /export async function POST/);
  assert.match(item, /export async function PATCH/);
  assert.match(item, /export async function DELETE/);
  assert.match(item, /defaultImageItemHandlers\s*=\s*createImageItemHandlers/);
  assert.match(item, /defaultImageItemHandlers\.PATCH/);
  assert.match(item, /defaultImageItemHandlers\.DELETE/);
  for (const source of [collection, item]) {
    assert.match(source, /auth\.getUser\(\)/);
    assert.match(source, /ensureCreatorWorkspace/);
  }
});

test('task and asset queries are explicitly scoped and draft snapshots include skill', () => {
  for (const source of [collection, item]) {
    assert.match(source, /\.eq\(['"]workspace_id['"]/);
    assert.match(source, /\.eq\(['"]user_id['"]/);
    assert.match(source, /\.eq\(['"]kind['"], ['"]image['"]\)/);
  }
  assert.match(collection, /idempotency_key/);
  assert.match(collection, /effective_prompt/);
  assert.match(collection, /reference_manifest/);
  assert.match(collection, /reference_paths/);
  assert.match(collection, /uploads_complete/);
  assert.match(collection, /skill: input\.skill/);
  assert.match(collection, /\.limit\(100\)/);
  assert.match(collection, /createSignedUrl/);
});

test('upload completion validates exact server-planned paths and downloaded private contents', () => {
  assert.match(item, /confirmImageReferenceUploads/);
  assert.match(storageService, /validateStoredImageDraftRequest/);
  assert.match(storageService, /validateCompletedReferencePaths/);
  assert.match(storageService, /validateReferenceUploadContents/);
  assert.doesNotMatch(item, /\.list\([^)]*search:/);
  assert.match(storageService, /uploads_complete: true/);
});

test('deletion cleans only the owned task prefix and result asset before database rows', () => {
  assert.match(item, /imageStorage/);
  assert.match(item, /deleteOwnedImageTask/);
  assert.match(item, /creator_assets/);
  assert.match(item, /creator_generation_tasks/);
  assert.match(item, /\.select\(['"]id['"]\)\s*\.maybeSingle\(\)/s);
  assert.doesNotMatch(item, /from\(['"]ai_usage_ledger['"]\)\.delete/);
  assert.doesNotMatch(item, /remove\(\[?`?\$\{user\.id\}`?\]?\)/);
});

test('image routes return stable error codes without raw dependency details', () => {
  assert.match(item, /error instanceof ImageStorageError/);
  assert.match(item, /code: error\.code/);
  for (const source of [collection, item]) {
    assert.match(source, /console\.error/);
    assert.doesNotMatch(source, /error:\s*error instanceof Error\s*\?\s*error\.message/);
    assert.doesNotMatch(source, /error:\s*[^,}\n]*\.message/);
  }
});

test('idempotency keys are required, normalized and namespaced per private owner', () => {
  assert.equal(normalizeImageIdempotencyKey('  retry-01  '), 'retry-01');
  assert.throws(() => normalizeImageIdempotencyKey('   '), /idempotency key/);
  assert.throws(() => normalizeImageIdempotencyKey(42), /idempotency key/);
  assert.equal(
    scopedImageIdempotencyKey('user-a', 'workspace-a', 'retry-01'),
    'creator-image:workspace-a:user-a:retry-01',
  );
  assert.notEqual(
    scopedImageIdempotencyKey('user-b', 'workspace-a', 'retry-01'),
    scopedImageIdempotencyKey('user-a', 'workspace-a', 'retry-01'),
  );
});

test('upload completion accepts only the exact ordered paths planned by the server', () => {
  const manifest = [
    { name: 'a.png', mimeType: 'image/png', size: 1 },
    { name: 'b.jpg', mimeType: 'image/jpeg', size: 1 },
  ];
  const expected = [
    'u1/image-tasks/t1/references/01.png',
    'u1/image-tasks/t1/references/02.jpg',
  ];
  assert.deepEqual(validateCompletedReferencePaths(expected, manifest, 'u1', 't1'), expected);
  assert.throws(() => validateCompletedReferencePaths([...expected].reverse(), manifest, 'u1', 't1'), /server plan/);
  assert.throws(() => validateCompletedReferencePaths(expected.slice(0, 1), manifest, 'u1', 't1'), /reference count/);
  assert.throws(() => validateCompletedReferencePaths([
    expected[0], 'u2/image-tasks/t1/references/02.jpg',
  ], manifest, 'u1', 't1'), /\u4e0d\u5c5e\u4e8e\u5f53\u524d\u4efb\u52a1/);
});

test('result deletion cannot escape the owned task result path', () => {
  assert.doesNotThrow(() => assertOwnedResultPath('u1/image-tasks/t1/result.png', 'u1', 't1'));
  assert.throws(() => assertOwnedResultPath('u1/image-tasks/t2/result.png', 'u1', 't1'), /current task/);
  assert.throws(() => assertOwnedResultPath('u1/image-tasks/t1/references/01.png', 'u1', 't1'), /current task/);
  assert.throws(() => assertOwnedResultPath('u1/image-tasks/t1/../other.png', 'u1', 't1'), /current task/);
});

type LookupResult = { data: Record<string, unknown> | null; error: unknown | null };

class FakeItemLookup {
  readonly filters: Array<[string, unknown]> = [];
  constructor(private readonly result: LookupResult) {}
  select(_columns: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  async maybeSingle() { return this.result; }
}

class FakeItemLocalClient {
  readonly queries: FakeItemLookup[] = [];
  readonly auth = { getUser: async () => ({ data: { user: { id: 'u1' } } }) };
  readonly storage = { from: (_bucket: string) => ({ bucket: 'creator-assets' }) };
  constructor(private readonly lookup: LookupResult) {}
  from(table: string) {
    assert.equal(table, 'creator_generation_tasks');
    const query = new FakeItemLookup(this.lookup);
    this.queries.push(query);
    return query;
  }
  async rpc() { return { data: 'w1', error: null }; }
}

const routeTask = {
  id: 't1', workspace_id: 'w1', user_id: 'u1', kind: 'image', model: 'gpt-image-2',
  request: {}, output: { asset_id: 'a1' },
};

function itemRequest(body: string) {
  return new Request('http://local/api/creator/images/t1', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body,
  });
}

function itemFixture(options: { lookup?: LookupResult; confirmError?: unknown; deleteError?: unknown } = {}) {
  const localClient = new FakeItemLocalClient(options.lookup || { data: routeTask, error: null });
  const calls = { confirm: 0, delete: 0 };
  const handlers = createImageItemHandlers({
    createClient: () => localClient,
    ensureCreatorWorkspace: async () => ({ id: 'w1' }),
    confirmImageReferenceUploads: async () => {
      calls.confirm += 1;
      if (options.confirmError) throw options.confirmError;
      return { id: 't1', status: 'draft' };
    },
    deleteOwnedImageTask: async () => {
      calls.delete += 1;
      if (options.deleteError) throw options.deleteError;
      return { id: 't1' };
    },
  });
  return { handlers, localClient, calls };
}

function assertItemLookup(query: FakeItemLookup) {
  assert.deepEqual(query.filters, [
    ['id', 't1'], ['workspace_id', 'w1'], ['user_id', 'u1'], ['kind', 'image'],
  ]);
}

test('PATCH factory handler scopes owned lookup and confirms once on success', async () => {
  const { handlers, localClient, calls } = itemFixture();
  const response = await handlers.PATCH(itemRequest('{"referencePaths":[]}'), { params: { id: 't1' } });
  assert.equal(response.status, 200);
  assert.equal(calls.confirm, 1);
  assertItemLookup(localClient.queries[0]);
});

test('PATCH factory handler returns 404 without confirming an absent task', async () => {
  const { handlers, calls } = itemFixture({ lookup: { data: null, error: null } });
  const response = await handlers.PATCH(itemRequest('{"referencePaths":[]}'), { params: { id: 't1' } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'IMAGE_TASK_NOT_FOUND');
  assert.equal(calls.confirm, 0);
});

test('PATCH factory handler rejects invalid JSON and fields without confirming', async () => {
  for (const body of ['{', '{"referencePaths":[],"prompt":"forbidden"}']) {
    const { handlers, calls } = itemFixture();
    const response = await handlers.PATCH(itemRequest(body), { params: { id: 't1' } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).code, /^INVALID_/);
    assert.equal(calls.confirm, 0);
  }
});

test('PATCH factory handler returns stable 4xx for confirm failure', async () => {
  const error = new ImageStorageError('REFERENCE_STORAGE_MISSING', new Error('secret confirm detail'));
  const { handlers, calls } = itemFixture({ confirmError: error });
  const response = await handlers.PATCH(itemRequest('{"referencePaths":[]}'), { params: { id: 't1' } });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, 'REFERENCE_STORAGE_MISSING');
  assert.doesNotMatch(JSON.stringify(payload), /secret confirm detail/);
  assert.equal(calls.confirm, 1);
});

test('PATCH factory handler returns stable 500 for owned lookup error', async () => {
  const { handlers, localClient, calls } = itemFixture({
    lookup: { data: null, error: new Error('secret database detail') },
  });
  const response = await handlers.PATCH(itemRequest('{"referencePaths":[]}'), { params: { id: 't1' } });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.code, 'UPLOAD_CONFIRM_FAILED');
  assert.doesNotMatch(JSON.stringify(payload), /secret database detail/);
  assert.equal(calls.confirm, 0);
  assertItemLookup(localClient.queries[0]);
});

test('DELETE factory handler scopes owned lookup and deletes once on success', async () => {
  const { handlers, localClient, calls } = itemFixture();
  const response = await handlers.DELETE(new Request('http://local', { method: 'DELETE' }), { params: { id: 't1' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: 't1' });
  assert.equal(calls.delete, 1);
  assertItemLookup(localClient.queries[0]);
});

test('DELETE factory handler returns 404 without deleting an absent task', async () => {
  const { handlers, calls } = itemFixture({ lookup: { data: null, error: null } });
  const response = await handlers.DELETE(new Request('http://local', { method: 'DELETE' }), { params: { id: 't1' } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'IMAGE_TASK_NOT_FOUND');
  assert.equal(calls.delete, 0);
});

test('DELETE factory handler returns stable 500 for service failure', async () => {
  const error = new ImageStorageError('TASK_STORAGE_DELETE_FAILED', new Error('secret delete detail'));
  const { handlers, calls } = itemFixture({ deleteError: error });
  const response = await handlers.DELETE(new Request('http://local', { method: 'DELETE' }), { params: { id: 't1' } });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.code, 'TASK_STORAGE_DELETE_FAILED');
  assert.doesNotMatch(JSON.stringify(payload), /secret delete detail/);
  assert.equal(calls.delete, 1);
});


test('confirm route is authenticated, owner-scoped, atomic and ledger-first', () => {
  assert.match(confirmRoute, /auth\.getUser\(\)/);
  assert.match(confirmRoute, /ensureCreatorWorkspace/);
  assert.match(confirmRoute, /\.eq\(['"]workspace_id['"]/);
  assert.match(confirmRoute, /\.eq\(['"]user_id['"]/);
  assert.match(confirmRoute, /\.eq\(['"]kind['"], ['"]image['"]\)/);
  assert.match(confirmRoute, /\.eq\(['"]status['"], ['"]draft['"]\)/);
  assert.match(confirmRoute, /buildCreatorImageLedgerEntry/);
  assert.match(confirmRoute, /recordUsageRequired/);
  assert.match(confirmRoute, /status: 'succeeded'/);
  assert.match(confirmRoute, /assertOwnedResultPath/);
  assert.match(confirmRoute, /loadValidatedReferenceContents/);
  assert.doesNotMatch(confirmRoute, /error:\s*error instanceof Error\s*\?\s*error\.message/);
});

class FakeConfirmQuery {
  readonly filters: Array<[string, unknown]> = [];
  constructor(private readonly result: { data: unknown; error: unknown | null }) {}
  update(_values: unknown) { return this; }
  select(_columns: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  async maybeSingle() { return this.result; }
}

class FakeConfirmLocalClient {
  readonly auth = { getUser: async () => ({ data: { user: { id: 'u1' } } }) };
  readonly storage = { from: (_bucket: string) => ({}) };
  readonly queries: FakeConfirmQuery[] = [];
  constructor(private readonly current: { data: unknown; error: unknown | null }) {}
  from(table: string) {
    assert.equal(table, 'creator_generation_tasks');
    const query = new FakeConfirmQuery(this.current);
    this.queries.push(query);
    return query;
  }
}

function confirmFixture(
  confirm: (input: unknown, deps: unknown) => Promise<unknown>,
  current: { data: unknown; error: unknown | null } = { data: { id: 't1', status: 'submitting' }, error: null },
) {
  const localClient = new FakeConfirmLocalClient(current);
  const handlers = createImageConfirmHandlers({
    createClient: () => localClient,
    ensureCreatorWorkspace: async () => ({ id: 'w1' }),
    confirmCreatorImage: confirm as never,
  });
  return { handlers, localClient };
}

function assertConfirmClaimFilters(query: FakeConfirmQuery) {
  assert.deepEqual(query.filters, [
    ['id', 't1'],
    ['workspace_id', 'w1'],
    ['user_id', 'u1'],
    ['kind', 'image'],
    ['status', 'draft'],
  ]);
}

function assertConfirmLookupFilters(query: FakeConfirmQuery) {
  assert.deepEqual(query.filters, [
    ['id', 't1'],
    ['workspace_id', 'w1'],
    ['user_id', 'u1'],
    ['kind', 'image'],
  ]);
}

test('confirm factory returns a real Response on success', async () => {
  const { handlers } = confirmFixture(async () => ({
    task: { id: 't1', status: 'succeeded' },
    asset: { id: 'a1' },
    resultUrl: 'signed',
  }));
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    task: { id: 't1', status: 'succeeded' },
    asset: { id: 'a1' },
    resultUrl: 'signed',
  });
});

test('confirm factory replays the current task for duplicate confirmation', async () => {
  const { handlers, localClient } = confirmFixture(async () => ({ duplicate: true }));
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    duplicate: true,
    task: { id: 't1', status: 'submitting' },
  });
  assertConfirmLookupFilters(localClient.queries[0]);
});

test('confirm factory claim uses an atomic owner-scoped draft filter', async () => {
  const { handlers, localClient } = confirmFixture(async (_input, dependencies) => {
    await (dependencies as { claimDraft: (input: { taskId: string; userId: string; workspaceId: string }) => Promise<unknown> })
      .claimDraft({ taskId: 't1', userId: 'u1', workspaceId: 'w1' });
    return { duplicate: true };
  });
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  assert.equal(result.status, 200);
  assertConfirmClaimFilters(localClient.queries[0]);
  assertConfirmLookupFilters(localClient.queries[1]);
});

test('confirm factory duplicate reconciliation state never replays as a normal duplicate', async () => {
  const { handlers, localClient } = confirmFixture(
    async () => ({ duplicate: true }),
    { data: { id: 't1', status: 'succeeded', output: { requires_reconciliation: true } }, error: null },
  );
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  const payload = await result.json();
  assert.equal(result.status, 503);
  assert.equal(payload.code, 'LEDGER_RECONCILIATION_REQUIRED');
  assert.equal(payload.requiresReconciliation, true);
  assertConfirmLookupFilters(localClient.queries[0]);
});

test('confirm factory maps result reconciliation to a stable 503', async () => {
  const { handlers } = confirmFixture(async () => {
    throw new CreatorImageConfirmError('RESULT_RECONCILIATION_REQUIRED', new Error('secret persistence detail'));
  });
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  const payload = await result.json();
  assert.equal(result.status, 503);
  assert.equal(payload.code, 'RESULT_RECONCILIATION_REQUIRED');
  assert.doesNotMatch(JSON.stringify(payload), /secret persistence detail/);
});

test('confirm factory maps timeout to 504 without leaking provider details', async () => {
  const timeout = Object.assign(new Error('secret provider detail'), { name: 'TimeoutError' });
  const { handlers } = confirmFixture(async () => { throw timeout; });
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  const payload = await result.json();
  assert.equal(result.status, 504);
  assert.equal(payload.code, 'GENERATION_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(payload), /secret provider detail/);
});

test('confirm factory exposes the sanitized Wetoken rejection for retry guidance', async () => {
  const { handlers } = confirmFixture(async () => {
    throw new WetokenImageRequestError(400, 'imageConfig.outputMIMEType is required; Bearer sk-secret-value');
  });
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  const payload = await result.json();
  assert.equal(result.status, 400);
  assert.equal(payload.code, 'WETOKEN_IMAGE_REQUEST_FAILED');
  assert.match(payload.error, /outputMIMEType/);
  assert.doesNotMatch(JSON.stringify(payload), /sk-secret-value/);
});

test('confirm factory rejects unauthenticated requests before invoking the service', async () => {
  let calls = 0;
  const localClient = new FakeConfirmLocalClient({ data: null, error: null });
  (localClient.auth.getUser as () => Promise<unknown>) = async () => ({ data: { user: null } });
  const handlers = createImageConfirmHandlers({
    createClient: () => localClient,
    ensureCreatorWorkspace: async () => ({ id: 'w1' }),
    confirmCreatorImage: async () => { calls += 1; return {}; },
  });
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});


test('confirm factory returns 503 reconciliation state after a successful task with unknown ledger status', async () => {
  const { handlers } = confirmFixture(async () => ({
    task: { id: 't1', status: 'succeeded' },
    asset: { id: 'a1' },
    resultUrl: 'signed',
    ledgerStatus: 'unknown',
    requiresReconciliation: true,
  }));
  const result = await handlers.POST(new Request('http://local/api/creator/images/t1/confirm'), { params: { id: 't1' } });
  const payload = await result.json();
  assert.equal(result.status, 503);
  assert.equal(payload.code, 'LEDGER_RECONCILIATION_REQUIRED');
  assert.equal(payload.ledgerStatus, 'unknown');
  assert.equal(payload.requiresReconciliation, true);
  assert.doesNotMatch(JSON.stringify(payload), /secret/);
});
