import { describe, expect, it } from "vitest";
import { ClaimStatus } from "./status.js";
import { SLA_WINDOWS, slaDeadlineFor, slaState, slaWindowFor } from "./sla.js";

const SENT = new Date("2026-11-04T09:00:00.000Z");

describe("SLA windows", () => {
  it("holds the IRDAI windows the desk is judged by", () => {
    expect(slaWindowFor("PRE_AUTH_SENT")).toMatchObject({
      hours: 1,
      owedBy: "insurer",
    });
    expect(slaWindowFor("FINAL_BILL_SUBMITTED")).toMatchObject({
      hours: 3,
      owedBy: "insurer",
    });
  });

  it("says in the basis string where an unmandated window came from", () => {
    expect(slaWindowFor("ENHANCEMENT_REQUESTED")?.basis).toContain(
      "no IRDAI window",
    );
  });

  it("gives a query no regulatory deadline, because the TPA's email is the deadline", () => {
    expect(slaWindowFor("QUERY_RAISED")).toBeNull();
    expect(slaDeadlineFor("QUERY_RAISED", SENT)).toBeNull();
  });

  it("leaves the desk's own states uncounted", () => {
    for (const status of [
      "DRAFT",
      "APPROVED",
      "SETTLED",
      "REJECTED",
    ] as const) {
      expect(slaWindowFor(status)).toBeNull();
    }
  });

  it("covers only statuses that exist", () => {
    for (const status of Object.keys(SLA_WINDOWS)) {
      expect(ClaimStatus.options).toContain(status);
    }
  });
});

describe("slaDeadlineFor", () => {
  it("stamps an hour out for a pre-auth", () => {
    expect(slaDeadlineFor("PRE_AUTH_SENT", SENT)?.toISOString()).toBe(
      "2026-11-04T10:00:00.000Z",
    );
  });

  it("stamps three hours out for a discharge authorisation", () => {
    expect(slaDeadlineFor("FINAL_BILL_SUBMITTED", SENT)?.toISOString()).toBe(
      "2026-11-04T12:00:00.000Z",
    );
  });
});

describe("slaState", () => {
  const window = slaWindowFor("PRE_AUTH_SENT");
  const deadline = slaDeadlineFor("PRE_AUTH_SENT", SENT)!;

  it("has no state without a deadline", () => {
    expect(slaState({ deadline: null, now: SENT }).state).toBe("none");
  });

  it("is ok with most of the window left", () => {
    const { state, remainingMs } = slaState({
      deadline,
      now: new Date("2026-11-04T09:10:00.000Z"),
      window,
    });
    expect(state).toBe("ok");
    expect(remainingMs).toBe(50 * 60_000);
  });

  it("is due soon inside the last quarter of the window", () => {
    expect(
      slaState({
        deadline,
        now: new Date("2026-11-04T09:50:00.000Z"),
        window,
      }).state,
    ).toBe("due_soon");
  });

  it("is breached once the deadline has passed", () => {
    const { state, remainingMs } = slaState({
      deadline,
      now: new Date("2026-11-04T10:30:00.000Z"),
      window,
    });
    expect(state).toBe("breached");
    expect(remainingMs).toBeLessThan(0);
  });

  it("is met, not breached, when the answer came back in time", () => {
    expect(
      slaState({
        deadline,
        resolvedAt: new Date("2026-11-04T09:40:00.000Z"),
        now: new Date("2026-11-09T00:00:00.000Z"),
        window,
      }).state,
    ).toBe("met");
  });

  it("is breached when the answer came back late, however long ago", () => {
    expect(
      slaState({
        deadline,
        resolvedAt: new Date("2026-11-04T11:40:00.000Z"),
        now: new Date("2026-11-09T00:00:00.000Z"),
        window,
      }).state,
    ).toBe("breached");
  });

  it("treats a malformed deadline as no deadline rather than an instant breach", () => {
    expect(slaState({ deadline: "not a date", now: SENT }).state).toBe("none");
  });
});
