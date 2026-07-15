import { getImageModel, sizeFor } from '@/lib/imageModels';

export const MAX_CREATOR_IMAGE_REFERENCES = 8;
export const MAX_CREATOR_IMAGE_FILE_BYTES = 7_000_000;
export const MAX_CREATOR_IMAGE_TOTAL_BYTES = 28_000_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
