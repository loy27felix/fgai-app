import { getImageModel, RATIOS, sizeFor } from '@/lib/imageModels';
import type { CreatorTaskStatus } from './types';

export const MAX_CREATOR_IMAGE_REFERENCES = 8;
export const MAX_CREATOR_IMAGE_FILE_BYTES = 7_000_000;
export const MAX_CREATOR_IMAGE_TOTAL_BYTES = 28_000_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export type ImageReferenceManifest = { name: string; mimeType: string; size: number };
export type CreatorImageSkill = { name: string; content: string };
export type ImageDraftInput = { prompt: string; model: string; ratio: string; references: ImageReferenceManifest[]; skill?: CreatorImageSkill | null };

export function composeImageGenerationPrompt(prompt: string, skill?: CreatorImageSkill | null) {
  if (!skill) return prompt;
  return `Apply the image-creation Skill "${skill.name}" below.\n\n${skill.content}\n\nUser image request:\n${prompt}`;
}

export function validateImageDraftInput(input: ImageDraftInput) {
  const prompt = input.prompt.trim();
  const skillName = typeof input.skill?.name === 'string' ? input.skill.name.trim().slice(0, 80) : '';
  const skillContent = typeof input.skill?.content === 'string' ? input.skill.content.trim().slice(0, 30_000) : '';
  const skill = skillName && skillContent ? { name: skillName, content: skillContent } : null;
  const effectivePrompt = composeImageGenerationPrompt(prompt, skill);
  const model = getImageModel(input.model);
  if (!prompt) throw new Error('提示词不能为空');
  if (!model) throw new Error('不支持的图片模型');
  if (input.references.length > Math.min(MAX_CREATOR_IMAGE_REFERENCES, model.maxReferences)) throw new Error('最多 8 张参考图');
  let total = 0;
  if (!RATIOS.some((item) => item.key === input.ratio)) throw new Error('invalid image ratio');
  for (const reference of input.references) {
    if (!ALLOWED_IMAGE_TYPES.has(reference.mimeType)) throw new Error('参考图仅支持 JPEG、PNG 或 WebP');
    if (!Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > MAX_CREATOR_IMAGE_FILE_BYTES) throw new Error('单张参考图不能超过 7MB');
    total += reference.size;
  }
  if (total > MAX_CREATOR_IMAGE_TOTAL_BYTES) throw new Error('参考图总大小不能超过 28MB');
  return { prompt, effectivePrompt, skill, model: model.id, ratio: input.ratio, size: sizeFor(model.id, input.ratio), references: input.references };
}

export function referencePathFor(userId: string, taskId: string, index: number, mimeType: string) {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return `${userId}/image-tasks/${taskId}/references/${String(index + 1).padStart(2, '0')}.${ext}`;
}

export function normalizeImageIdempotencyKey(input: unknown) {
  if (typeof input !== 'string') throw new Error('idempotency key is required');
  const value = input.normalize('NFC').trim();
  if (!value) throw new Error('idempotency key is required');
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('invalid idempotency key');
  }
  return value;
}

export function scopedImageIdempotencyKey(userId: string, workspaceId: string, key: string) {
  return `creator-image:${workspaceId}:${userId}:${key}`;
}

const OWNED_REFERENCE_ERROR = '\u53c2\u8003\u56fe\u4e0d\u5c5e\u4e8e\u5f53\u524d\u4efb\u52a1';
const OWNED_RESULT_ERROR = 'result file does not belong to the current task';

function isSafePathSegment(segment: string) {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('\0');
}

export function assertOwnedReferencePath(path: string, userId: string, taskId: string) {
  const segments = path.split('/');
  const isOwned = segments.length === 5
    && segments[0] === userId
    && segments[1] === 'image-tasks'
    && segments[2] === taskId
    && segments[3] === 'references'
    && isSafePathSegment(userId)
    && isSafePathSegment(taskId)
    && isSafePathSegment(segments[4]);

  if (!isOwned) throw new Error(OWNED_REFERENCE_ERROR);
}


export function assertOwnedResultPath(path: string, userId: string, taskId: string) {
  const segments = path.split('/');
  const isOwned = segments.length === 4
    && segments[0] === userId
    && segments[1] === 'image-tasks'
    && segments[2] === taskId
    && /^result\.(?:png|jpe?g|webp)$/.test(segments[3])
    && isSafePathSegment(userId)
    && isSafePathSegment(taskId)
    && isSafePathSegment(segments[3]);

  if (!isOwned) throw new Error(OWNED_RESULT_ERROR);
}

export function validateCompletedReferencePaths(
  paths: unknown,
  manifest: ImageReferenceManifest[],
  userId: string,
  taskId: string,
) {
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) {
    throw new Error('invalid referencePaths');
  }
  if (paths.length !== manifest.length) throw new Error('reference count does not match manifest');
  return paths.map((path, index) => {
    assertOwnedReferencePath(path, userId, taskId);
    const expected = referencePathFor(userId, taskId, index, manifest[index].mimeType);
    if (path !== expected) throw new Error('reference upload path does not match server plan');
    return path;
  });
}

export function isCreatorImageTerminal(status: CreatorTaskStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'expired';
}

function storedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stored image draft is invalid');
  }
  return value as Record<string, unknown>;
}

function storedSkill(value: unknown): CreatorImageSkill | null {
  if (value === null) return null;
  const skill = storedRecord(value);
  if (typeof skill.name !== 'string' || typeof skill.content !== 'string') {
    throw new Error('stored image skill is invalid');
  }
  return { name: skill.name, content: skill.content };
}

function storedReferences(value: unknown): ImageReferenceManifest[] {
  if (!Array.isArray(value)) throw new Error('stored reference manifest is invalid');
  return value.map((entry) => {
    const reference = storedRecord(entry);
    if (
      typeof reference.name !== 'string'
      || typeof reference.mimeType !== 'string'
      || typeof reference.size !== 'number'
    ) {
      throw new Error('stored reference manifest is invalid');
    }
    return {
      name: reference.name,
      mimeType: reference.mimeType,
      size: reference.size,
    };
  });
}

export function validateStoredImageDraftRequest(model: unknown, request: unknown) {
  const value = storedRecord(request);
  if (
    typeof model !== 'string'
    || typeof value.prompt !== 'string'
    || typeof value.ratio !== 'string'
    || typeof value.effective_prompt !== 'string'
    || typeof value.size !== 'string'
  ) {
    throw new Error('stored image draft is invalid');
  }
  const skill = storedSkill(value.skill);
  const validated = validateImageDraftInput({
    prompt: value.prompt,
    model,
    ratio: value.ratio,
    skill,
    references: storedReferences(value.reference_manifest),
  });
  const sameSkill = validated.skill?.name === skill?.name
    && validated.skill?.content === skill?.content;
  if (
    validated.prompt !== value.prompt
    || !sameSkill
    || validated.effectivePrompt !== value.effective_prompt
    || validated.size !== value.size
  ) {
    throw new Error('stored image draft snapshot is invalid');
  }
  return validated;
}
