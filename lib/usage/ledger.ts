import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

type TextUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | undefined;

export type TextLedgerEntry = {
  request_id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  creator_task_id: null;
  kind: 'text';
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_source: 'unknown';
  price_snapshot: Record<string, never>;
  status: 'succeeded';
  possibly_charged: true;
};

type LedgerWriter = {
  upsert(row: TextLedgerEntry): Promise<unknown>;
};

function tokenCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value! : 0;
}

export function buildTextLedgerEntry(input: {
  requestId?: string;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: string;
  model: string;
  usage: TextUsage;
}): TextLedgerEntry {
  const inputTokens = tokenCount(input.usage?.prompt_tokens);
  const outputTokens = tokenCount(input.usage?.completion_tokens);
  return {
    request_id: input.requestId || randomUUID(),
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    creator_task_id: null,
    kind: 'text',
    provider: input.provider,
    model: input.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: tokenCount(input.usage?.total_tokens) || inputTokens + outputTokens,
    cost_source: 'unknown',
    price_snapshot: {},
    status: 'succeeded',
    possibly_charged: true,
  };
}

export async function recordUsageBestEffort(
  row: TextLedgerEntry,
  dependency?: LedgerWriter,
): Promise<boolean> {
  try {
    const result = dependency
      ? await dependency.upsert(row)
      : await createAdminClient()
        .from('ai_usage_ledger')
        .upsert(row, { onConflict: 'request_id' });
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
