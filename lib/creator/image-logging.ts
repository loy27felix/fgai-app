import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';

type ImageLogLevel = 'info' | 'warn' | 'error';

export type CreatorImageLogFields = Record<string, unknown>;

export function redactCreatorImageLogText(value: unknown) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, '[已隐藏]')
    .replace(/((?:token|signature|sig|key|secret|password)=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function logCreatorImageEvent(
  stage: string,
  fields: CreatorImageLogFields = {},
  level: ImageLogLevel = 'info',
) {
  logServerEvent('creator_image', { stage, ...fields }, level);
}

export function logCreatorImageFailure(
  stage: string,
  error: unknown,
  fields: CreatorImageLogFields = {},
) {
  logServerFailure('creator_image', error, { stage, ...fields });
}
