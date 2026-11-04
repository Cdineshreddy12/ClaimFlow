import type { ClaimStatus } from "@claimflow/contracts";
import { STATUS_LABEL } from "../claims/types";
import type { Claim } from "../claims/types";
import type { InboxQuery } from "../queries/types";

const TERMINAL: ClaimStatus[] = ["SETTLED", "REJECTED"];
const NEEDS_ATTENTION: ClaimStatus[] = [
  "QUERY_RAISED",
  "ENHANCEMENT_REQUESTED",
];

export interface DashboardMetrics {
  openClaims: number;
  needsAttention: number;
  openQueries: number;
  overdueQueries: number;
  /** Hours, averaged over open claims' time since their last status change — a real, computable stand-in for the brief's discharge-wait metric, which would need event tracking this schema doesn't have yet. */
  avgTimeInStageHours: number | null;
  byStatus: { status: ClaimStatus; label: string; count: number }[];
}

export function computeDashboardMetrics(
  claims: Claim[],
  openQueries: InboxQuery[],
  now: number,
): DashboardMetrics {
  const open = claims.filter((c) => !TERMINAL.includes(c.status));

  const stageHours = open.map(
    (c) => (now - new Date(c.updatedAt).getTime()) / 3_600_000,
  );
  const avgTimeInStageHours =
    stageHours.length > 0
      ? stageHours.reduce((a, b) => a + b, 0) / stageHours.length
      : null;

  const counts = new Map<ClaimStatus, number>();
  for (const claim of claims)
    counts.set(claim.status, (counts.get(claim.status) ?? 0) + 1);
  const byStatus = [...counts.entries()]
    .map(([status, count]) => ({ status, label: STATUS_LABEL[status], count }))
    .sort((a, b) => b.count - a.count);

  return {
    openClaims: open.length,
    needsAttention: claims.filter((c) => NEEDS_ATTENTION.includes(c.status))
      .length,
    openQueries: openQueries.length,
    overdueQueries: openQueries.filter(
      (q) => q.deadline && new Date(q.deadline).getTime() < now,
    ).length,
    avgTimeInStageHours,
    byStatus,
  };
}
