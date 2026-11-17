export function isLegacySupportUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export function isSupportUserId(value: unknown): value is string {
  return typeof value === 'string' && (/^[a-f0-9]{32}$/i.test(value) || isLegacySupportUserId(value));
}
