import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertOwnedResultPath,
  normalizeImageIdempotencyKey,
  scopedImageIdempotencyKey,
  validateCompletedReferencePaths,
} from '../../lib/creator/image';

const collectionPath = path.join(process.cwd(), 'app/api/creator/images/route.ts');
const itemPath = path.join(process.cwd(), 'app/api/creator/images/[id]/route.ts');
const collection = fs.readFileSync(collectionPath, 'utf8');
const item = fs.readFileSync(itemPath, 'utf8');

test('all creator image operations authenticate and bootstrap the private workspace', () => {
  assert.match(collection, /export async function GET/);
  assert.match(collection, /export async function POST/);
  assert.match(item, /export async function PATCH/);
  assert.match(item, /export async function DELETE/);
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
  assert.match(item, /validateCompletedReferencePaths/);
  assert.match(item, /assertOwnedReferencePath/);
  assert.match(item, /referencePathFor/);
  assert.match(item, /validateReferenceUploadContents/);
  assert.doesNotMatch(item, /\.list\([^)]*search:/);
  assert.match(item, /uploads_complete: true/);
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

test('item route returns stable storage error codes without raw dependency details', () => {
  assert.match(item, /error instanceof ImageStorageError/);
  assert.match(item, /code: error\.code/);
  assert.match(item, /console\.error/);
  assert.doesNotMatch(item, /error: `[^`]*\$\{[^}]*\.error\.message\}/);
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
