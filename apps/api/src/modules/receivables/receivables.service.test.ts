import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "./receivables.repository.js";
import { getAgeing } from "./receivables.service.js";

vi.mock("./receivables.repository.js");

const NOW = new Date("2026-11-05T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function row(overrides: Partial<repo.OutstandingClaimRow> = {}) {
  return {
    claimId: "c1",
    reference: "CLM-0001",
    patientName: "Rajendra Pawar",
    insurerName: "Company B",
    status: "FINAL_BILL_SUBMITTED",
    billedAt: daysAgo(10),
    outstanding: 100_000,
    ...overrides,
  } as repo.OutstandingClaimRow;
}

const auth = { userId: "u1", role: "desk_head" as const };

describe("receivables ageing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buckets by days since the final bill, with no gaps or overlaps at the edges", async () => {
    vi.mocked(repo.listOutstanding).mockResolvedValue([
      row({ claimId: "a", billedAt: daysAgo(0), outstanding: 1 }),
      row({ claimId: "b", billedAt: daysAgo(30), outstanding: 2 }),
      // 31 is the first day of the next bucket — the boundary is where
      // an off-by-one hides, so both sides of it are pinned.
      row({ claimId: "c", billedAt: daysAgo(31), outstanding: 4 }),
      row({ claimId: "d", billedAt: daysAgo(60), outstanding: 8 }),
      row({ claimId: "e", billedAt: daysAgo(61), outstanding: 16 }),
      row({ claimId: "f", billedAt: daysAgo(90), outstanding: 32 }),
      row({ claimId: "g", billedAt: daysAgo(91), outstanding: 64 }),
      row({ claimId: "h", billedAt: daysAgo(400), outstanding: 128 }),
    ]);

    const report = await getAgeing(auth, NOW);

    expect(report.buckets.map((b) => [b.key, b.total])).toEqual([
      ["0_30", 3],
      ["31_60", 12],
      ["61_90", 48],
      ["over_90", 192],
    ]);
    // Every claim lands in exactly one bucket.
    expect(report.buckets.reduce((n, b) => n + b.claims, 0)).toBe(8);
    expect(report.total).toBe(255);
  });

  it("groups by insurer, biggest exposure first", async () => {
    vi.mocked(repo.listOutstanding).mockResolvedValue([
      row({ claimId: "a", insurerName: "Small Co", outstanding: 10_000 }),
      row({
        claimId: "b",
        insurerName: "Big Co",
        outstanding: 50_000,
        billedAt: daysAgo(70),
      }),
      row({ claimId: "c", insurerName: "Big Co", outstanding: 20_000 }),
    ]);

    const report = await getAgeing(auth, NOW);

    // This list is read to decide who to chase; alphabetical decides
    // nothing.
    expect(report.byInsurer[0]).toMatchObject({
      insurerName: "Big Co",
      claims: 2,
      total: 70_000,
      oldestDays: 70,
    });
    expect(report.byInsurer[1]!.insurerName).toBe("Small Co");
  });

  it("puts the oldest claims at the top of the chase list", async () => {
    vi.mocked(repo.listOutstanding).mockResolvedValue([
      row({ claimId: "new", billedAt: daysAgo(2) }),
      row({ claimId: "old", billedAt: daysAgo(200) }),
    ]);

    const report = await getAgeing(auth, NOW);

    expect(report.oldest[0]!.claimId).toBe("old");
    expect(report.oldest[0]!.days).toBe(200);
  });

  it("reports an empty desk as zero rather than as nothing", async () => {
    vi.mocked(repo.listOutstanding).mockResolvedValue([]);

    const report = await getAgeing(auth, NOW);

    // All four buckets still render, so an empty ageing view reads as
    // "nothing owed" instead of a broken page.
    expect(report.buckets).toHaveLength(4);
    expect(report.total).toBe(0);
    expect(report.claims).toBe(0);
  });
});
