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
export type CreatorVideoTaskStatus = CreatorTaskStatus | 'awaiting_reconciliation';

export type CreatorImageTask = {
  id: string;
  workspace_id: string;
  canvas_id?: string | null;
  node_id?: string | null;
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

export type CreatorVideoTask = {
  id: string;
  workspace_id: string;
  canvas_id?: string | null;
  node_id?: string | null;
  user_id: string;
  kind: 'video';
  provider: 'wetoken';
  model: string;
  filter_off?: boolean;
  external_task_id?: string | null;
  status: CreatorVideoTaskStatus;
  idempotency_key: string;
  request: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  confirmed_at: string | null;
  submission_started_at?: string | null;
  reconciliation_required_at?: string | null;
  last_provider_checked_at?: string | null;
  submission_attempts?: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CreatorVideoTaskView = CreatorVideoTask & {
  videoUrl: string | null;
  referenceUrls: string[];
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

export type CreatorCanvasGraph = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<{ from: string; to: string }>;
  /** Persisted viewport state, compatible with the infinite-canvas reference. */
  viewport?: { x: number; y: number; zoom: number; k?: number };
  background?: "grid" | "dots" | "blank";
  appearance?: {
    backgroundImagePath?: string;
    backgroundImageOpacity?: number;
    gridOpacity?: number;
  };
};

export type CreatorCanvas = {
  id: string;
  workspace_id: string;
  session_id: string | null;
  folder_id: string | null;
  kind: 'image' | 'video';
  title: string;
  graph: CreatorCanvasGraph;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CreatorProductionStatus = 'draft' | 'planning' | 'ready' | 'rendering' | 'assembling' | 'succeeded' | 'failed';

/** A durable director-led production, separate from ordinary Agent chats. */
export type CreatorProduction = {
  id: string;
  workspace_id: string;
  session_id: string;
  canvas_project_id: string | null;
  title: string;
  stage: string;
  status: CreatorProductionStatus;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreatorVideoAssemblyJob = {
  id: string;
  workspace_id: string;
  user_id: string;
  production_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
