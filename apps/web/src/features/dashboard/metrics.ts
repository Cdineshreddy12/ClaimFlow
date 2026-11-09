import type { ClaimOverview } from "@claimflow/contracts";
import type { InboxQuery } from "../queries/types";

/**
 * The KPI row, assembled from two sources.
 *
 * The claim figures are counted in the database now — the whole
 * dashboard used to fetch every claim the hospital had ever opened and
 * work them out in the browser, which is two thousand rows over the
 * wire to render six numbers.
 *
 * The query figures stay here on purpose: the inbox returns only OPEN
 * queries, which is bounded by what a desk is actually chasing, and
 * "overdue" depends on the clock the user is looking at rather than
 * the server's.
 */
export interface DashboardMetrics {
  openClaims: number;
  /** Settled this calendar month — the counterweight to the gap counts. */
  /**
   * Claims the money arrived for this month, counted on the payment
   * date. Deliberately not the same question as the status donut's
   * "Settled" slice, which counts claims sitting in that status now —
   * the two were labelled alike and read as one number disagreeing
   * with itself.
   */
  paidThisMonth: number;
  /** What the insurers actually paid on those, in rupees. */
  settledValueThisMonth: number;
  needsAttention: number;
  openQueries: number;
  overdueQueries: number;
  /** Hours, averaged over open claims' time since their last status change. */
  avgTimeInStageHours: number | null;
}

export function dashboardMetrics(
  overview: ClaimOverview | undefined,
  openQueries: InboxQuery[],
  now: number,
): DashboardMetrics {
  return {
    openClaims: overview?.openClaims ?? 0,
    paidThisMonth: overview?.settledThisMonth.count ?? 0,
    settledValueThisMonth: overview?.settledThisMonth.value ?? 0,
    needsAttention: overview?.needsAttention ?? 0,
    avgTimeInStageHours: overview?.avgTimeInStageHours ?? null,
    openQueries: openQueries.length,
    overdueQueries: openQueries.filter(
      (q) => q.deadline && new Date(q.deadline).getTime() < now,
    ).length,
  };
}
