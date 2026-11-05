import { describe, expect, it } from "vitest";
import type { Claim } from "../claims/types";
import type { InboxQuery } from "../queries/types";
import { computeDashboardMetrics } from "./metrics";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: "c1",
    reference: "CLM-0001",
    patientName: "Test Patient",
    insurerId: "i1",
    insurerName: "Insurer",
    procedureId: "p1",
    procedureName: "Procedure",
    status: "PRE_AUTH_SENT",
    assignedTo: null,
    checklistSnapshot: [],
    billedAmount: null,
    sanctionedAmount: null,
    settledAmount: null,
    settledOn: null,
    slaDeadline: null,
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
    claimReference: "CLM-0001",
    tpaRawEmail: null,
    aiSummary: null,
    requestedItems: [],
    summarisedBy: null,
    deadline: null,
    deadlineInferred: false,
    deadlineConfirmedAt: null,
    replySentAt: null,
    createdAt: new Date(NOW).toISOString(),
    claimPatientName: "Test Patient",
    claimStatus: "QUERY_RAISED",
    insurerName: "Test Insurer",
    procedureName: "Test Procedure",
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
});

describe("completedThisMonth", () => {
  const thisMonth = new Date(NOW);
  thisMonth.setDate(2);
  const lastMonth = new Date(NOW);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("counts claims whose payment landed this month", () => {
    const metrics = computeDashboardMetrics(
      [
        claim({ id: "a", settledOn: iso(thisMonth), settledAmount: "150000" }),
        claim({ id: "b", settledOn: iso(lastMonth), settledAmount: "90000" }),
        claim({ id: "c" }),
      ],
      [],
      NOW,
    );
    expect(metrics.completedThisMonth).toBe(1);
    expect(metrics.settledValueThisMonth).toBe(150000);
  });

  it("counts on the payment date, not the status", () => {
    // A claim marked settled in October whose money arrived in November
    // belongs to November — that's the month the desk gets credit for.
    const metrics = computeDashboardMetrics(
      [
        claim({
          id: "late",
          status: "SETTLED",
          settledOn: iso(lastMonth),
          settledAmount: "50000",
        }),
      ],
      [],
      NOW,
    );
    expect(metrics.completedThisMonth).toBe(0);
  });

  it("is zero when nothing has been paid", () => {
    const metrics = computeDashboardMetrics([claim({ id: "a" })], [], NOW);
    expect(metrics.completedThisMonth).toBe(0);
    expect(metrics.settledValueThisMonth).toBe(0);
  });
});
