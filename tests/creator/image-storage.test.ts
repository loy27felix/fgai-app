import assert from 'node:assert/strict';
import test from 'node:test';
import { referencePathFor, validateImageDraftInput } from '../../lib/creator/image';
import {
  cleanupImageTaskPrefix,
  confirmImageReferenceUploads,
  deleteOwnedImageTask,
  ImageStorageError,
  validateReferenceUploadContents,
  type CreatorImageDeletionStore,
  type CreatorImagePatchStore,
  type CreatorImageStorage,
  type StorageListEntry,
} from '../../lib/creator/imageStorage';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function blob(bytes: Uint8Array) {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return new Blob([copy]);
}

class FakeStorage implements CreatorImageStorage {
  objects = new Map<string, Blob>();
  listCalls: Array<{ prefix: string; limit: number; offset: number }> = [];
  removeCalls: string[][] = [];
  downloadErrorFor: string | null = null;
  listErrorFor: string | null = null;
  removeFails = false;
  leaveBehind: string | null = null;
  listOverride: ((prefix: string, limit: number, offset: number) => StorageListEntry[]) | null = null;
  onRemove: (() => void) | null = null;

  async download(path: string) {
    if (path === this.downloadErrorFor) return { data: null, error: new Error('secret storage detail') };
    return { data: this.objects.get(path) || null, error: null };
  }

  async list(prefix: string, options: { limit: number; offset: number }) {
    this.listCalls.push({ prefix, ...options });
    if (prefix === this.listErrorFor) return { data: null, error: new Error('secret list detail') };
    if (this.listOverride) return { data: this.listOverride(prefix, options.limit, options.offset), error: null };
    const direct = new Map<string, StorageListEntry>();
    const base = `${prefix}/`;
    for (const path of this.objects.keys()) {
      if (!path.startsWith(base)) continue;
      const remainder = path.slice(base.length);
      const slash = remainder.indexOf('/');
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      direct.set(name, { name, id: slash === -1 ? `file-${name}` : null });
    }
    const entries = [...direct.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { data: entries.slice(options.offset, options.offset + options.limit), error: null };
  }

  async remove(paths: string[]) {
    this.removeCalls.push([...paths]);
    this.onRemove?.();
    if (this.removeFails) return { error: new Error('secret remove detail') };
    for (const path of paths) {
      if (path !== this.leaveBehind) this.objects.delete(path);
    }
    return { error: null };
  }
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof ImageStorageError
    && error.code === code
    && !error.message.includes('secret');
}

test('reference validation downloads exact paths and accepts matching size and magic bytes', async () => {
  const storage = new FakeStorage();
  const paths = ['p/01.png', 'p/02.jpg', 'p/03.webp'];
  const bytes = [PNG, JPEG, WEBP];
  const mimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
  paths.forEach((path, index) => storage.objects.set(path, blob(bytes[index])));

  await validateReferenceUploadContents(storage, paths, paths.map((path, index) => ({
    name: path,
    mimeType: mimeTypes[index],
    size: bytes[index].byteLength,
  })));
});

test('reference validation rejects actual size mismatch before completion', async () => {
  const storage = new FakeStorage();
  storage.objects.set('p/01.png', blob(PNG));
  await assert.rejects(
    validateReferenceUploadContents(storage, ['p/01.png'], [{
      name: 'a.png', mimeType: 'image/png', size: PNG.byteLength + 1,
    }]),
    expectCode('REFERENCE_SIZE_MISMATCH'),
  );
});

test('reference validation rejects spoofed MIME content with the right length', async () => {
  const storage = new FakeStorage();
  storage.objects.set('p/01.png', blob(new Uint8Array(PNG.byteLength)));
  await assert.rejects(
    validateReferenceUploadContents(storage, ['p/01.png'], [{
      name: 'a.png', mimeType: 'image/png', size: PNG.byteLength,
    }]),
    expectCode('REFERENCE_TYPE_MISMATCH'),
  );
});

test('reference validation converts storage failures to a stable error code', async () => {
  const storage = new FakeStorage();
  storage.downloadErrorFor = 'p/01.png';
  await assert.rejects(
    validateReferenceUploadContents(storage, ['p/01.png'], [{
      name: 'a.png', mimeType: 'image/png', size: PNG.byteLength,
    }]),
    expectCode('REFERENCE_STORAGE_READ_FAILED'),
  );
});

test('task cleanup paginates beyond 100 files and recursively removes nested objects', async () => {
  const storage = new FakeStorage();
  const prefix = 'u1/image-tasks/t1';
  for (let index = 0; index < 125; index += 1) {
    storage.objects.set(`${prefix}/file-${String(index).padStart(3, '0')}.png`, blob(PNG));
  }
  storage.objects.set(`${prefix}/references/nested/01.jpg`, blob(JPEG));
  storage.objects.set(`${prefix}/result.webp`, blob(WEBP));
  storage.objects.set('u1/image-tasks/other/result.png', blob(PNG));

  await cleanupImageTaskPrefix(storage, prefix);

  assert.deepEqual([...storage.objects.keys()], ['u1/image-tasks/other/result.png']);
  assert.ok(storage.removeCalls.flat().every((path) => path.startsWith(`${prefix}/`)));
  assert.ok(storage.listCalls.some((call) => call.prefix === prefix && call.offset === 100));
  assert.ok(storage.removeCalls.length >= 2);
});

test('task cleanup fails closed on list and remove errors', async () => {
  const prefix = 'u1/image-tasks/t1';
  const listFailure = new FakeStorage();
  listFailure.listErrorFor = prefix;
  await assert.rejects(cleanupImageTaskPrefix(listFailure, prefix), expectCode('TASK_STORAGE_LIST_FAILED'));

  const removeFailure = new FakeStorage();
  removeFailure.objects.set(`${prefix}/result.png`, blob(PNG));
  removeFailure.removeFails = true;
  await assert.rejects(cleanupImageTaskPrefix(removeFailure, prefix), expectCode('TASK_STORAGE_DELETE_FAILED'));
});

test('task cleanup verifies no object remains after a partial remove', async () => {
  const storage = new FakeStorage();
  const prefix = 'u1/image-tasks/t1';
  const remaining = `${prefix}/result.png`;
  storage.objects.set(remaining, blob(PNG));
  storage.leaveBehind = remaining;
  await assert.rejects(cleanupImageTaskPrefix(storage, prefix), expectCode('TASK_STORAGE_NOT_EMPTY'));
});

test('task cleanup rejects abnormal directory entries instead of recursing forever', async () => {
  const storage = new FakeStorage();
  storage.listOverride = () => [{ name: '..', id: null }];
  await assert.rejects(
    cleanupImageTaskPrefix(storage, 'u1/image-tasks/t1'),
    expectCode('TASK_STORAGE_INVALID_TREE'),
  );
});

function deletionStore(overrides: Partial<CreatorImageDeletionStore> = {}): CreatorImageDeletionStore {
  return {
    loadAsset: async () => ({ data: null, error: null }),
    deleteAsset: async () => ({ deleted: true, error: null }),
    deleteTask: async () => ({ deleted: true, error: null }),
    ...overrides,
  };
}

const ownedTask = {
  id: 't1',
  userId: 'u1',
  workspaceId: 'w1',
  assetId: 'a1',
};

test('owned deletion aborts before storage when a referenced result asset is missing or unreadable', async () => {
  for (const result of [
    { data: null, error: null },
    { data: null, error: new Error('secret db detail') },
  ]) {
    const storage = new FakeStorage();
    let taskDeletes = 0;
    const store = deletionStore({
      loadAsset: async () => result,
      deleteTask: async () => { taskDeletes += 1; return { deleted: true, error: null }; },
    });
    await assert.rejects(
      deleteOwnedImageTask(storage, store, ownedTask),
      expectCode(result.error ? 'RESULT_ASSET_LOOKUP_FAILED' : 'RESULT_ASSET_MISSING'),
    );
    assert.equal(storage.listCalls.length, 0);
    assert.equal(taskDeletes, 0);
  }
});

test('owned deletion refuses ok when asset delete affects zero rows', async () => {
  const storage = new FakeStorage();
  let taskDeletes = 0;
  const store = deletionStore({
    loadAsset: async () => ({
      data: { id: 'a1', storagePath: 'u1/image-tasks/t1/result.png' }, error: null,
    }),
    deleteAsset: async () => ({ deleted: false, error: null }),
    deleteTask: async () => { taskDeletes += 1; return { deleted: true, error: null }; },
  });
  await assert.rejects(
    deleteOwnedImageTask(storage, store, ownedTask),
    expectCode('RESULT_ASSET_DELETE_MISSING'),
  );
  assert.equal(taskDeletes, 0);
});

test('owned deletion refuses ok when task delete affects zero rows', async () => {
  const storage = new FakeStorage();
  const store = deletionStore({ deleteTask: async () => ({ deleted: false, error: null }) });
  await assert.rejects(
    deleteOwnedImageTask(storage, store, { ...ownedTask, assetId: null }),
    expectCode('IMAGE_TASK_DELETE_MISSING'),
  );
});

function imagePatchTask(references: Array<{ name: string; mimeType: string; size: number }>) {
  const canonical = validateImageDraftInput({
    prompt: 'a fox', model: 'gpt-image-2', ratio: '1:1', references: [],
  });
  return {
    id: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    model: 'gpt-image-2',
    request: {
      prompt: canonical.prompt,
      effective_prompt: canonical.effectivePrompt,
      skill: canonical.skill,
      ratio: canonical.ratio,
      size: canonical.size,
      reference_manifest: references,
      reference_paths: [],
      uploads_complete: false,
    },
  };
}

function imagePatchStore(onUpdate: () => void): CreatorImagePatchStore {
  return {
    updateTask: async (_taskId, _workspaceId, _userId, request) => {
      onUpdate();
      return { data: { id: 't1', request }, error: null };
    },
  };
}

test('patch orchestration never updates owner-tampered stored manifests', async () => {
  const cases = [
    Array.from({ length: 9 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', size: 1 })),
    [{ name: 'large.png', mimeType: 'image/png', size: 7_000_001 }],
    [
      ...Array.from({ length: 4 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', size: 7_000_000 })),
      { name: 'extra.png', mimeType: 'image/png', size: 1 },
    ],
    [{ name: 'payload.gif', mimeType: 'image/gif', size: 1 }],
  ];
  for (const references of cases) {
    let updates = 0;
    const task = imagePatchTask(references);
    const paths = references.map((reference, index) => (
      referencePathFor(task.userId, task.id, index, reference.mimeType)
    ));
    await assert.rejects(
      confirmImageReferenceUploads(new FakeStorage(), imagePatchStore(() => { updates += 1; }), task, paths),
      expectCode('STORED_IMAGE_DRAFT_INVALID'),
    );
    assert.equal(updates, 0);
  }
});

test('patch orchestration never updates missing or MIME-spoofed uploads', async () => {
  const reference = { name: 'a.png', mimeType: 'image/png', size: PNG.byteLength };
  const task = imagePatchTask([reference]);
  const paths = [referencePathFor(task.userId, task.id, 0, reference.mimeType)];
  for (const bytes of [null, new Uint8Array(PNG.byteLength)]) {
    const storage = new FakeStorage();
    if (bytes) storage.objects.set(paths[0], blob(bytes));
    let updates = 0;
    await assert.rejects(
      confirmImageReferenceUploads(storage, imagePatchStore(() => { updates += 1; }), task, paths),
      expectCode(bytes ? 'REFERENCE_TYPE_MISMATCH' : 'REFERENCE_STORAGE_MISSING'),
    );
    assert.equal(updates, 0);
  }
});

test('patch orchestration updates only after stored draft and exact blob validation', async () => {
  const reference = { name: 'a.png', mimeType: 'image/png', size: PNG.byteLength };
  const task = imagePatchTask([reference]);
  const path = referencePathFor(task.userId, task.id, 0, reference.mimeType);
  const storage = new FakeStorage();
  storage.objects.set(path, blob(PNG));
  let updates = 0;
  const result = await confirmImageReferenceUploads(
    storage,
    imagePatchStore(() => { updates += 1; }),
    task,
    [path],
  );
  assert.equal(updates, 1);
  assert.equal((result as { id: string }).id, 't1');
});

test('owned deletion blocks every mutation for an invalid result path', async () => {
  const storage = new FakeStorage();
  let mutations = 0;
  const store = deletionStore({
    loadAsset: async () => ({ data: { id: 'a1', storagePath: 'u1/image-tasks/t2/result.png' }, error: null }),
    deleteAsset: async () => { mutations += 1; return { deleted: true, error: null }; },
    deleteTask: async () => { mutations += 1; return { deleted: true, error: null }; },
  });
  await assert.rejects(deleteOwnedImageTask(storage, store, ownedTask), expectCode('RESULT_ASSET_PATH_INVALID'));
  assert.equal(storage.listCalls.length, 0);
  assert.equal(storage.removeCalls.length, 0);
  assert.equal(mutations, 0);
});

test('owned deletion blocks database mutations on list or remove failure', async () => {
  for (const kind of ['list', 'remove'] as const) {
    const storage = new FakeStorage();
    const prefix = 'u1/image-tasks/t1';
    if (kind === 'list') storage.listErrorFor = prefix;
    if (kind === 'remove') {
      storage.objects.set(`${prefix}/result.png`, blob(PNG));
      storage.removeFails = true;
    }
    let mutations = 0;
    const store = deletionStore({
      loadAsset: async () => ({ data: { id: 'a1', storagePath: `${prefix}/result.png` }, error: null }),
      deleteAsset: async () => { mutations += 1; return { deleted: true, error: null }; },
      deleteTask: async () => { mutations += 1; return { deleted: true, error: null }; },
    });
    await assert.rejects(
      deleteOwnedImageTask(storage, store, ownedTask),
      expectCode(kind === 'list' ? 'TASK_STORAGE_LIST_FAILED' : 'TASK_STORAGE_DELETE_FAILED'),
    );
    assert.equal(mutations, 0);
  }
});

test('owned deletion mutation order is storage then asset then task', async () => {
  const storage = new FakeStorage();
  const prefix = 'u1/image-tasks/t1';
  storage.objects.set(`${prefix}/result.png`, blob(PNG));
  const events: string[] = [];
  storage.onRemove = () => events.push('storage');
  const store = deletionStore({
    loadAsset: async () => ({ data: { id: 'a1', storagePath: `${prefix}/result.png` }, error: null }),
    deleteAsset: async () => { events.push('asset'); return { deleted: true, error: null }; },
    deleteTask: async () => { events.push('task'); return { deleted: true, error: null }; },
  });
  await deleteOwnedImageTask(storage, store, ownedTask);
  assert.deepEqual(events, ['storage', 'asset', 'task']);
});
