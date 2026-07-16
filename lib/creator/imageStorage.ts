import {
  assertOwnedResultPath,
  validateCompletedReferencePaths,
  validateStoredImageDraftRequest,
  type ImageReferenceManifest,
} from './image';
import type { ImageReference } from '@/lib/ai/image';

export type StorageListEntry = { name: string; id?: string | null };

export type CreatorImageStorage = {
  download(path: string): Promise<{ data: Blob | null; error: unknown | null }>;
  list(
    prefix: string,
    options: { limit: number; offset: number },
  ): Promise<{ data: StorageListEntry[] | null; error: unknown | null }>;
  remove(paths: string[]): Promise<{ error: unknown | null }>;
};

export type CreatorImagePatchStore = {
  updateTask(
    taskId: string,
    workspaceId: string,
    userId: string,
    request: Record<string, unknown>,
  ): Promise<{ data: unknown | null; error: unknown | null }>;
};

export type OwnedImageTaskPatch = {
  id: string;
  userId: string;
  workspaceId: string;
  model: string;
  request: unknown;
};

export type CreatorImageDeletionStore = {
  loadAsset(
    assetId: string,
    workspaceId: string,
  ): Promise<{ data: { id: string; storagePath: string } | null; error: unknown | null }>;
  deleteAsset(
    assetId: string,
    workspaceId: string,
  ): Promise<{ deleted: boolean; error: unknown | null }>;
  deleteTask(
    taskId: string,
    workspaceId: string,
    userId: string,
  ): Promise<{ deleted: boolean; error: unknown | null }>;
};

export type OwnedImageTaskDeletion = {
  id: string;
  userId: string;
  workspaceId: string;
  assetId: string | null;
};

const ERROR_MESSAGES = {
  STORED_IMAGE_DRAFT_INVALID: '\u56fe\u7247\u4efb\u52a1\u53c2\u6570\u5df2\u88ab\u7be1\u6539\uff0c\u5df2\u505c\u6b62\u786e\u8ba4',
  REFERENCE_PATHS_INVALID: '\u53c2\u8003\u56fe\u8def\u5f84\u65e0\u6548',
  IMAGE_TASK_UPDATE_FAILED: '\u56fe\u7247\u4efb\u52a1\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  IMAGE_TASK_UPDATE_MISSING: '\u56fe\u7247\u4efb\u52a1\u672a\u88ab\u66f4\u65b0\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5',
  REFERENCE_MANIFEST_INVALID: '参考图清单无效，请重新创建任务',
  REFERENCE_STORAGE_READ_FAILED: '参考图读取失败，请重新上传',
  REFERENCE_STORAGE_MISSING: '参考图未上传完整',
  REFERENCE_SIZE_MISMATCH: '参考图文件大小与清单不一致',
  REFERENCE_TYPE_MISMATCH: '参考图文件类型与清单不一致',
  TASK_STORAGE_INVALID_TREE: '任务文件目录异常，已停止删除',
  TASK_STORAGE_LIST_FAILED: '任务文件读取失败，请稍后重试',
  TASK_STORAGE_DELETE_FAILED: '任务文件删除失败，请稍后重试',
  TASK_STORAGE_NOT_EMPTY: '任务文件未完全删除，请稍后重试',
  RESULT_ASSET_LOOKUP_FAILED: '结果素材读取失败，请稍后重试',
  RESULT_ASSET_MISSING: '结果素材不存在，已停止删除',
  RESULT_ASSET_PATH_INVALID: '结果素材路径异常，已停止删除',
  RESULT_ASSET_DELETE_FAILED: '结果素材删除失败，请稍后重试',
  RESULT_ASSET_DELETE_MISSING: '结果素材未被删除，已停止操作',
  IMAGE_TASK_DELETE_FAILED: '图片任务删除失败，请稍后重试',
  IMAGE_TASK_DELETE_MISSING: '图片任务未被删除，请刷新后重试',
} as const;

export type ImageStorageErrorCode = keyof typeof ERROR_MESSAGES;

export class ImageStorageError extends Error {
  readonly code: ImageStorageErrorCode;
  readonly publicMessage: string;

  constructor(code: ImageStorageErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = 'ImageStorageError';
    this.code = code;
    this.publicMessage = ERROR_MESSAGES[code];
  }
}

function hasPrefix(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function matchesMime(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/webp') {
    return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
      && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  return false;
}

/** Read and validate private reference objects once for a provider request. */
export async function loadValidatedReferenceContents(
  storage: CreatorImageStorage,
  paths: string[],
  manifest: ImageReferenceManifest[],
): Promise<ImageReference[]> {
  if (paths.length !== manifest.length) throw new ImageStorageError('REFERENCE_MANIFEST_INVALID');
  const references: ImageReference[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const result = await storage.download(paths[index]);
    if (result.error) throw new ImageStorageError('REFERENCE_STORAGE_READ_FAILED', result.error);
    if (!result.data) throw new ImageStorageError('REFERENCE_STORAGE_MISSING');
    if (result.data.size !== manifest[index].size) {
      throw new ImageStorageError('REFERENCE_SIZE_MISMATCH');
    }
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    if (!matchesMime(bytes, manifest[index].mimeType)) {
      throw new ImageStorageError('REFERENCE_TYPE_MISMATCH');
    }
    references.push({
      data: Buffer.from(bytes).toString('base64'),
      mimeType: manifest[index].mimeType,
    });
  }
  return references;
}

export async function validateReferenceUploadContents(
  storage: CreatorImageStorage,
  paths: string[],
  manifest: ImageReferenceManifest[],
) {
  await loadValidatedReferenceContents(storage, paths, manifest);
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;
const MAX_TREE_DEPTH = 16;
const MAX_TREE_ENTRIES = 10_000;

function isSafeSegment(value: string) {
  return value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0');
}

function assertTaskPrefix(prefix: string) {
  const segments = prefix.split('/');
  if (
    segments.length !== 3
    || segments[1] !== 'image-tasks'
    || !isSafeSegment(segments[0])
    || !isSafeSegment(segments[2])
  ) {
    throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');
  }
}

async function listTaskFiles(storage: CreatorImageStorage, rootPrefix: string) {
  assertTaskPrefix(rootPrefix);
  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: rootPrefix, depth: 0 }];
  const visited = new Set<string>();
  const files = new Set<string>();
  let entryCount = 0;

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.prefix)) continue;
    visited.add(current.prefix);
    if (current.depth > MAX_TREE_DEPTH || visited.size > MAX_TREE_ENTRIES) {
      throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');
    }

    let offset = 0;
    while (true) {
      const listed = await storage.list(current.prefix, { limit: LIST_PAGE_SIZE, offset });
      if (listed.error) throw new ImageStorageError('TASK_STORAGE_LIST_FAILED', listed.error);
      const entries = listed.data || [];
      entryCount += entries.length;
      if (entryCount > MAX_TREE_ENTRIES) throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');

      for (const entry of entries) {
        if (!isSafeSegment(entry.name)) throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');
        const path = `${current.prefix}/${entry.name}`;
        if (entry.id === null) {
          if (current.depth >= MAX_TREE_DEPTH) throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');
          if (!visited.has(path)) queue.push({ prefix: path, depth: current.depth + 1 });
        } else {
          files.add(path);
        }
      }

      if (entries.length < LIST_PAGE_SIZE) break;
      offset += entries.length;
      if (offset > MAX_TREE_ENTRIES) throw new ImageStorageError('TASK_STORAGE_INVALID_TREE');
    }
  }

  return [...files];
}

export async function cleanupImageTaskPrefix(storage: CreatorImageStorage, prefix: string) {
  const paths = await listTaskFiles(storage, prefix);
  for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
    const removed = await storage.remove(paths.slice(index, index + REMOVE_BATCH_SIZE));
    if (removed.error) throw new ImageStorageError('TASK_STORAGE_DELETE_FAILED', removed.error);
  }
  const remaining = await listTaskFiles(storage, prefix);
  if (remaining.length) throw new ImageStorageError('TASK_STORAGE_NOT_EMPTY');
}

export async function deleteOwnedImageTask(
  storage: CreatorImageStorage,
  store: CreatorImageDeletionStore,
  task: OwnedImageTaskDeletion,
) {
  let asset: { id: string; storagePath: string } | null = null;
  if (task.assetId) {
    const loaded = await store.loadAsset(task.assetId, task.workspaceId);
    if (loaded.error) throw new ImageStorageError('RESULT_ASSET_LOOKUP_FAILED', loaded.error);
    if (!loaded.data || loaded.data.id !== task.assetId) {
      throw new ImageStorageError('RESULT_ASSET_MISSING');
    }
    asset = loaded.data;
    try {
      assertOwnedResultPath(asset.storagePath, task.userId, task.id);
    } catch (error: unknown) {
      throw new ImageStorageError('RESULT_ASSET_PATH_INVALID', error);
    }
  }

  await cleanupImageTaskPrefix(storage, `${task.userId}/image-tasks/${task.id}`);

  if (asset) {
    const deletedAsset = await store.deleteAsset(asset.id, task.workspaceId);
    if (deletedAsset.error) {
      throw new ImageStorageError('RESULT_ASSET_DELETE_FAILED', deletedAsset.error);
    }
    if (!deletedAsset.deleted) throw new ImageStorageError('RESULT_ASSET_DELETE_MISSING');
  }

  const deletedTask = await store.deleteTask(task.id, task.workspaceId, task.userId);
  if (deletedTask.error) throw new ImageStorageError('IMAGE_TASK_DELETE_FAILED', deletedTask.error);
  if (!deletedTask.deleted) throw new ImageStorageError('IMAGE_TASK_DELETE_MISSING');
  return { id: task.id };
}

export async function confirmImageReferenceUploads(
  storage: CreatorImageStorage,
  store: CreatorImagePatchStore,
  task: OwnedImageTaskPatch,
  referencePaths: unknown,
) {
  let validated: ReturnType<typeof validateStoredImageDraftRequest>;
  try {
    validated = validateStoredImageDraftRequest(task.model, task.request);
  } catch (error: unknown) {
    throw new ImageStorageError('STORED_IMAGE_DRAFT_INVALID', error);
  }

  let paths: string[];
  try {
    paths = validateCompletedReferencePaths(
      referencePaths,
      validated.references,
      task.userId,
      task.id,
    );
  } catch (error: unknown) {
    throw new ImageStorageError('REFERENCE_PATHS_INVALID', error);
  }

  await validateReferenceUploadContents(storage, paths, validated.references);
  const original = task.request as Record<string, unknown>;
  const request = {
    ...original,
    prompt: validated.prompt,
    effective_prompt: validated.effectivePrompt,
    skill: validated.skill,
    ratio: validated.ratio,
    size: validated.size,
    reference_manifest: validated.references,
    reference_paths: paths,
    uploads_complete: true,
  };
  const updated = await store.updateTask(task.id, task.workspaceId, task.userId, request);
  if (updated.error) throw new ImageStorageError('IMAGE_TASK_UPDATE_FAILED', updated.error);
  if (!updated.data) throw new ImageStorageError('IMAGE_TASK_UPDATE_MISSING');
  return updated.data;
}
