export type ConversationViewport = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function isConversationNearBottom(
  viewport: ConversationViewport,
  threshold = 120,
): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold;
}
