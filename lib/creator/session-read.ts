import type { CreatorKind, CreatorMessage, CreatorSession } from '@/lib/creator/types';

const CREATOR_KINDS: CreatorKind[] = ['chat', 'image', 'video'];
const MESSAGE_ROLES: CreatorMessage['role'][] = ['system', 'user', 'assistant', 'tool'];
const MESSAGE_STATUSES: CreatorMessage['status'][] = ['draft', 'streaming', 'complete', 'failed'];

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Local deployments created before creator session migrations can lack optional
 * columns such as archived_at/updated_at. Read raw rows, then normalize and
 * filter in JavaScript so historical conversations remain visible.
 */
export function normalizeCreatorSessions(rows: unknown[], requestedKind?: CreatorKind | null): CreatorSession[] {
  return rows
    .map((value) => {
      const row = record(value);
      const rawKind = string(row.kind, 'chat');
      const kind = CREATOR_KINDS.includes(rawKind as CreatorKind) ? rawKind as CreatorKind : 'chat';
      const createdAt = string(row.created_at);
      return {
        id: string(row.id),
        workspace_id: string(row.workspace_id),
        folder_id: nullableString(row.folder_id),
        kind,
        title: string(row.title, '未命名对话'),
        default_model: nullableString(row.default_model),
        archived_at: nullableString(row.archived_at),
        created_at: createdAt,
        updated_at: string(row.updated_at, createdAt),
      } satisfies CreatorSession;
    })
    .filter((session) => Boolean(session.id) && !session.archived_at && (!requestedKind || session.kind === requestedKind))
    .sort((left, right) => timestamp(right.updated_at || right.created_at) - timestamp(left.updated_at || left.created_at));
}

export function normalizeCreatorMessages(rows: unknown[]): CreatorMessage[] {
  return rows
    .map((value) => {
      const row = record(value);
      const rawRole = string(row.role, 'assistant');
      const rawStatus = string(row.status, 'complete');
      return {
        id: string(row.id),
        session_id: string(row.session_id),
        role: MESSAGE_ROLES.includes(rawRole as CreatorMessage['role']) ? rawRole as CreatorMessage['role'] : 'assistant',
        content: record(row.content),
        status: MESSAGE_STATUSES.includes(rawStatus as CreatorMessage['status']) ? rawStatus as CreatorMessage['status'] : 'complete',
        created_at: string(row.created_at),
      } satisfies CreatorMessage;
    })
    .filter((message) => Boolean(message.id) && Boolean(message.session_id))
    .sort((left, right) => timestamp(left.created_at) - timestamp(right.created_at));
}
