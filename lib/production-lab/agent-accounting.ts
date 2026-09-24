import { buildTextLedgerEntry, type TextLedgerEntry } from "../usage/ledger";

export const PRODUCTION_LAB_AGENT_LEDGER_SOURCE = "production-lab-agent";

export function buildProductionAgentLedgerEntry(input: {
  requestId: string;
  providerRequestId?: string;
  userId: string;
  projectId: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  reportedCostUsd?: number;
  durationMs: number;
}): TextLedgerEntry {
  const entry = buildTextLedgerEntry({
    requestId: input.requestId,
    providerRequestId: input.providerRequestId,
    userId: input.userId,
    projectId: input.projectId,
    provider: "wetoken",
    model: input.model,
    usage: input.usage,
    estimateOnlyWhenUsageKnown: true,
    reportedCostUsd: input.reportedCostUsd,
    durationMs: input.durationMs,
  });

  return {
    ...entry,
    price_snapshot: {
      ...entry.price_snapshot,
      production_lab_source: PRODUCTION_LAB_AGENT_LEDGER_SOURCE,
    },
  };
}
