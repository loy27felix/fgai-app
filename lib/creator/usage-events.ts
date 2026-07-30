export const CREATOR_USAGE_UPDATED_EVENT = 'fg-creator-usage-updated';

export function notifyCreatorUsageUpdated() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CREATOR_USAGE_UPDATED_EVENT));
}
