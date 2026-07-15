import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupImageTaskPrefix,
  deleteOwnedImageTask,
  ImageStorageError,
  validateReferenceUploadContents,
  type CreatorImageDeletionStore,
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
