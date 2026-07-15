export const CREATOR_TASK_STATUSES = [
  'draft',
  'submitting',
  'queued',
  'running',
  'succeeded',
  'failed',
  'expired',
  'unknown',
] as const;

export type CreatorTaskStatus = (typeof CREATOR_TASK_STATUSES)[number];
export type CreatorKind = 'chat' | 'image' | 'video';

export type CreatorWorkspace = {
  id: string;
  owner_id: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
