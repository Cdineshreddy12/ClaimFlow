import { describe, expect, it } from "vitest";
import type { Claim } from "../claims/types";
import type { InboxQuery } from "../queries/types";
import { computeDashboardMetrics } from "./metrics";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: "c1",
    organizationId: "org1",
    patientName: "Test Patient",
    insurerId: "i1",
    insurerName: "Insurer",
    procedureId: "p1",
    procedureName: "Procedure",
    status: "PRE_AUTH_SENT",
    assignedTo: null,
    checklistSnapshot: [],
    billedAmount: null,
    admittedAt: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function query(overrides: Partial<InboxQuery>): InboxQuery {
  return {
    id: "q1",
    claimId: "c1",
    tpaRawEmail: null,
    aiSummary: null,
    requestedItems: [],
    deadline: null,
    replySentAt: null,
    createdAt: new Date(NOW).toISOString(),
    claimPatientName: "Test Patient",
    claimStatus: "QUERY_RAISED",
    ...overrides,
  };
}

describe("computeDashboardMetrics", () => {
  it("excludes settled/rejected claims from openClaims", () => {
    const claims = [
      claim({ status: "SETTLED" }),
      claim({ status: "REJECTED" }),
      claim({ status: "PRE_AUTH_SENT" }),
    ];
    expect(computeDashboardMetrics(claims, [], NOW).openClaims).toBe(1);
  });

  it("counts query and enhancement claims as needing attention", () => {
    const claims = [
      claim({ status: "QUERY_RAISED" }),
      claim({ status: "ENHANCEMENT_REQUESTED" }),
      claim({ status: "APPROVED" }),
    ];
    expect(computeDashboardMetrics(claims, [], NOW).needsAttention).toBe(2);
  });

  it("flags a query as overdue only once its deadline has passed", () => {
    const queries = [
      query({ id: "overdue", deadline: new Date(NOW - 60_000).toISOString() }),
      query({ id: "future", deadline: new Date(NOW + 60_000).toISOString() }),
      query({ id: "no-deadline", deadline: null }),
    ];
    const metrics = computeDashboardMetrics([], queries, NOW);
    expect(metrics.openQueries).toBe(3);
    expect(metrics.overdueQueries).toBe(1);
  });

  it("averages time-in-stage across open claims only, in hours", () => {
    const claims = [
      claim({
        status: "PRE_AUTH_SENT",
        updatedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
      }),
      claim({
        status: "QUERY_RAISED",
        updatedAt: new Date(NOW - 4 * 3_600_000).toISOString(),
      }),
      claim({
        status: "SETTLED",
        updatedAt: new Date(NOW - 100 * 3_600_000).toISOString(),
      }),
    ];
    expect(computeDashboardMetrics(claims, [], NOW).avgTimeInStageHours).toBe(
      3,
    );
  });

  it("returns null average time-in-stage when there are no open claims", () => {
    expect(
      computeDashboardMetrics([claim({ status: "SETTLED" })], [], NOW)
        .avgTimeInStageHours,
    ).toBeNull();
  });

  it("groups claims by status, sorted by count descending", () => {
    const claims = [
      claim({ status: "QUERY_RAISED" }),
      claim({ status: "QUERY_RAISED" }),
      claim({ status: "APPROVED" }),
    ];
    const byStatus = computeDashboardMetrics(claims, [], NOW).byStatus;
    expect(byStatus[0]).toMatchObject({ status: "QUERY_RAISED", count: 2 });
    expect(byStatus[1]).toMatchObject({ status: "APPROVED", count: 1 });
  });
});
