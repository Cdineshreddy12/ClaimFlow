import { describe, expect, it } from "vitest";
import type { ClaimOverview } from "@claimflow/contracts";
import { dashboardMetrics } from "./metrics";
import type { InboxQuery } from "../queries/types";

const NOW = new Date("2026-11-06T12:00:00Z").getTime();

function overview(partial: Partial<ClaimOverview> = {}): ClaimOverview {
  return {
    openClaims: 3,
    needsAttention: 1,
    avgTimeInStageHours: 9.5,
    settledThisMonth: { count: 2, value: 330_000 },
    byStatus: [],
    settledTrend: [],
    waiting: [],
    ...partial,
  };
}

function query(deadline: string | null): InboxQuery {
  return { id: "q", deadline } as unknown as InboxQuery;
}

/**
 * The claim figures are counted in the database now — their rules are
 * tested against a real one in claims.repository.integration. What is
 * left here is the assembly, and the one figure that still depends on
 * the clock the reader is looking at.
 */
describe("dashboardMetrics", () => {
  it("passes the server's counts through untouched", () => {
    const m = dashboardMetrics(overview(), [], NOW);
    expect(m.openClaims).toBe(3);
    expect(m.needsAttention).toBe(1);
    expect(m.completedThisMonth).toBe(2);
    expect(m.settledValueThisMonth).toBe(330_000);
    expect(m.avgTimeInStageHours).toBe(9.5);
  });

  it("reads as an empty desk while the request is in flight", () => {
    // Zeroes, not NaN or "—": the KPI row renders before the response
    // lands and a flash of broken numbers is worse than a flash of nil.
    const m = dashboardMetrics(undefined, [], NOW);
    expect(m.openClaims).toBe(0);
    expect(m.settledValueThisMonth).toBe(0);
    expect(m.avgTimeInStageHours).toBeNull();
  });

  it("flags a query as overdue only once its deadline has passed", () => {
    const m = dashboardMetrics(
      overview(),
      [
        query("2026-11-05T12:00:00Z"),
        query("2026-11-07T12:00:00Z"),
        query(null),
      ],
      NOW,
    );
    expect(m.openQueries).toBe(3);
    expect(m.overdueQueries).toBe(1);
  });
});
