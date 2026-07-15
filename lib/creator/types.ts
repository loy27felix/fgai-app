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

export type CreatorImageTask = {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: 'image';
  provider: 'wetoken';
  model: string;
  status: CreatorTaskStatus;
  idempotency_key: string;
  request: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CreatorImageAsset = {
  id: string;
  workspace_id: string;
  kind: 'image';
  source: 'generation';
  name: string;
  storage_path: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CreatorImageTaskView = CreatorImageTask & {
  asset: CreatorImageAsset | null;
  resultUrl: string | null;
  referenceUrls: string[];
};

export type CreatorKind = 'chat' | 'image' | 'video';

export type CreatorWorkspace = {
  id: string;
  owner_id: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreatorSession = {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  kind: CreatorKind;
  title: string;
  default_model: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreatorMessage = {
  id: string;
  session_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: { text?: string; images?: string[]; image_count?: number; usage?: Record<string, number> };
  status: 'draft' | 'streaming' | 'complete' | 'failed';
  created_at: string;
};
