type Ledger = Record<string, unknown>;

function record(value: unknown): Ledger {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Ledger : {};
}

export function resolveLabMediaAccounting(providerReferenceId: string | null | undefined, ledgerValue: unknown, storedEstimate?: unknown, storedReport?: unknown, accountingError?: unknown) {
  const ledger = record(ledgerValue);
  const snapshot = record(ledger.price_snapshot);
  const exactReference = Boolean(providerReferenceId && ledger.provider_request_id === providerReferenceId);
  const reconciled = exactReference && snapshot.reconciliation_source === "wetoken_fee_log_csv";
  return {
    exactReference,
    reconciled,
    estimateUsd: ledger.estimated_cost_usd ?? storedEstimate ?? null,
    reportedUsd: exactReference ? (ledger.reported_cost_usd ?? storedReport ?? null) : null,
    settledUsd: reconciled ? ledger.reported_cost_usd ?? null : null,
    ledgerStatus: ledger.status ?? null,
    status: reconciled ? "已按 WeToken Reference ID 对账"
      : exactReference ? "已记账 · 等待 WeToken 费用单"
        : accountingError || ledger.error ? "费用账本待处理"
          : providerReferenceId ? "等待费用账本" : "尚无可核对 Reference ID",
  };
}
