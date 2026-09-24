export type CostLine = { settledUsd?: unknown; reportedUsd?: unknown; estimatedUsd?: unknown };
export type CostBuckets = { settledUsd: number; reportedUsd: number; estimatedUsd: number; unknownCount: number };
export type MembershipInterval = { userId: string; groupId: string; groupName: string; assignedAt: string; unassignedAt: string | null };
export type GroupSpendCandidate = CostBuckets & { groupId: string; requests: number };
export type GroupStatus = { id: string; archivedAt: string | null };

export function emptyCostBuckets(): CostBuckets {
  return { settledUsd: 0, reportedUsd: 0, estimatedUsd: 0, unknownCount: 0 };
}

function money(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Add a single request to exactly one evidence bucket, preferring the strongest evidence. */
export function addCostLine(summary: CostBuckets, line: CostLine) {
  const settled = money(line.settledUsd);
  if (settled !== null) summary.settledUsd += settled;
  else {
    const reported = money(line.reportedUsd);
    if (reported !== null) summary.reportedUsd += reported;
    else {
      const estimated = money(line.estimatedUsd);
      if (estimated !== null) summary.estimatedUsd += estimated;
      else summary.unknownCount += 1;
    }
  }
  return summary;
}

/** Resolve the group that owned a request when it was created, even after members move. */
export function groupAtTime(history: MembershipInterval[], userId: string, at: string) {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return null;
  return history.find((membership) => {
    if (membership.userId !== userId) return false;
    const start = Date.parse(membership.assignedAt);
    const end = membership.unassignedAt ? Date.parse(membership.unassignedAt) : Number.POSITIVE_INFINITY;
    return Number.isFinite(start) && start <= timestamp && end > timestamp;
  }) || null;
}

/** Keep active groups visible, but show archived groups only when they have history. */
export function visibleGroupSpendRows<T extends GroupSpendCandidate>(rows: T[], groups: GroupStatus[]) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  return rows.flatMap((row) => {
    if (row.groupId === "__unassigned__") return row.requests > 0 ? [{ ...row, archivedAt: null }] : [];
    const group = groupById.get(row.groupId);
    if (!group) return [];
    const hasHistory = row.requests > 0 || row.unknownCount > 0 || row.settledUsd > 0 || row.reportedUsd > 0 || row.estimatedUsd > 0;
    if (group.archivedAt && !hasHistory) return [];
    return [{ ...row, archivedAt: group.archivedAt }];
  });
}
