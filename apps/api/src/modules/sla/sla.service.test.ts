import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "./sla.repository.js";

vi.mock("./sla.repository.js");

const auth = { userId: "u", role: "desk_head" as const };
const NOW = new Date("2026-11-04T10:00:00.000Z");

function clock(over: Partial<repo.SlaWatchRow> = {}): repo.SlaWatchRow {
  return {
    claimId: "c1",
    reference: "CLM-0001",
    patientName: "Meera Joshi",
    insurerName: "Star Health",
    status: "PRE_AUTH_SENT",
    enteredAt: new Date("2026-11-04T09:00:00.000Z"),
    slaDeadline: new Date("2026-11-04T10:00:00.000Z"),
    ...over,
  };
}

describe("sla.service.getSlaWatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts the most overdue claim first", async () => {
    vi.mocked(repo.listOpenClaimClocks).mockResolvedValue([
      clock({
        claimId: "soon",
        slaDeadline: new Date("2026-11-04T10:50:00.000Z"),
      }),
      clock({
        claimId: "late",
        slaDeadline: new Date("2026-11-04T08:00:00.000Z"),
      }),
      clock({
        claimId: "ok",
        slaDeadline: new Date("2026-11-04T18:00:00.000Z"),
      }),
    ]);

    const { getSlaWatch } = await import("./sla.service.js");
    const watch = await getSlaWatch(auth, NOW);

    expect(watch.items.map((i) => i.claimId)).toEqual(["late", "soon", "ok"]);
    expect(watch.items[0]!.state).toBe("breached");
  });

  it("counts breaches, and says how many are the insurer's to answer", async () => {
    vi.mocked(repo.listOpenClaimClocks).mockResolvedValue([
      clock({
        claimId: "a",
        slaDeadline: new Date("2026-11-04T08:00:00.000Z"),
      }),
      clock({
        claimId: "b",
        status: "FINAL_BILL_SUBMITTED",
        slaDeadline: new Date("2026-11-04T09:00:00.000Z"),
      }),
      clock({
        claimId: "c",
        slaDeadline: new Date("2026-11-04T10:10:00.000Z"),
      }),
    ]);

    const { getSlaWatch } = await import("./sla.service.js");
    const watch = await getSlaWatch(auth, NOW);

    expect(watch.breached).toBe(2);
    expect(watch.breachedOnInsurer).toBe(2);
    expect(watch.dueSoon).toBe(1);
  });

  it("leaves claims with no clock off the list entirely", async () => {
    // An approved claim waiting on the hospital isn't late; it isn't
    // waiting on anybody.
    vi.mocked(repo.listOpenClaimClocks).mockResolvedValue([
      clock({ claimId: "approved", status: "APPROVED", slaDeadline: null }),
      clock({ claimId: "draft", status: "DRAFT", slaDeadline: null }),
      clock({ claimId: "sent" }),
    ]);

    const { getSlaWatch } = await import("./sla.service.js");
    const watch = await getSlaWatch(auth, NOW);

    expect(watch.items.map((i) => i.claimId)).toEqual(["sent"]);
  });

  it("carries the basis of each window so the UI never has to assert it", async () => {
    vi.mocked(repo.listOpenClaimClocks).mockResolvedValue([clock()]);

    const { getSlaWatch } = await import("./sla.service.js");
    const watch = await getSlaWatch(auth, NOW);

    expect(watch.items[0]!.basis).toContain("IRDAI");
    expect(watch.items[0]!.owedBy).toBe("insurer");
  });
});

describe("sla.service.getTurnaroundReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts each insurer's actual time next to the window it's held to", async () => {
    vi.mocked(repo.insurerTurnaround).mockResolvedValue([
      {
        insurerName: "Star Health",
        fromStatus: "FINAL_BILL_SUBMITTED",
        decisions: 20,
        avgHours: 11.4,
        worstHours: 31,
        breaches: 16,
      },
    ]);

    const { getTurnaroundReport } = await import("./sla.service.js");
    const report = await getTurnaroundReport(auth, new Date("2026-10-01"));

    expect(report.rows[0]).toMatchObject({
      targetHours: 3,
      avgHours: 11.4,
      breaches: 16,
      breachRate: 0.8,
    });
  });

  it("doesn't divide by zero decisions", async () => {
    vi.mocked(repo.insurerTurnaround).mockResolvedValue([
      {
        insurerName: "Niva Bupa",
        fromStatus: "PRE_AUTH_SENT",
        decisions: 0,
        avgHours: 0,
        worstHours: 0,
        breaches: 0,
      },
    ]);

    const { getTurnaroundReport } = await import("./sla.service.js");
    const report = await getTurnaroundReport(auth, new Date("2026-10-01"));
    expect(report.rows[0]!.breachRate).toBe(0);
  });

  it("reports no target for a status no regulation covers", async () => {
    vi.mocked(repo.insurerTurnaround).mockResolvedValue([
      {
        insurerName: "Star Health",
        fromStatus: "QUERY_RAISED",
        decisions: 4,
        avgHours: 50,
        worstHours: 90,
        breaches: 0,
      },
    ]);

    const { getTurnaroundReport } = await import("./sla.service.js");
    const report = await getTurnaroundReport(auth, new Date("2026-10-01"));
    expect(report.rows[0]!.targetHours).toBeNull();
  });
});
