import { beforeEach, describe, expect, it, vi } from "vitest";
import * as deductionsService from "../deductions/deductions.service.js";
import * as slaService from "../sla/sla.service.js";
import * as repo from "./reports.repository.js";

vi.mock("./reports.repository.js");
vi.mock("../deductions/deductions.service.js");
vi.mock("../sla/sla.service.js");

const auth = { userId: "u", role: "desk_head" as const };
const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-11-01T00:00:00.000Z");

describe("reports.service.getPeriodReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assembles the three underlying reports for the same window", async () => {
    vi.mocked(repo.periodClaimsSummary).mockResolvedValue({
      opened: 12,
      settled: 9,
      settledValue: 900_000,
      avgTatDays: 11.5,
    });
    vi.mocked(deductionsService.summarise).mockResolvedValue({
      total: 50_000,
      avoidableTotal: 30_000,
      recoveredTotal: 5_000,
      byReason: [],
    });
    vi.mocked(slaService.getTurnaroundReport).mockResolvedValue({
      since: FROM,
      rows: [],
    });

    const { getPeriodReport } = await import("./reports.service.js");
    const report = await getPeriodReport(auth, FROM, TO);

    expect(report.from).toBe(FROM);
    expect(report.to).toBe(TO);
    expect(report.claims.opened).toBe(12);
    expect(report.deductions.total).toBe(50_000);
    expect(report.turnaround.rows).toEqual([]);

    // Every underlying call gets the same closed window — a report
    // whose three sections silently covered different periods would
    // be worse than no report.
    expect(repo.periodClaimsSummary).toHaveBeenCalledWith(FROM, TO);
    expect(deductionsService.summarise).toHaveBeenCalledWith(auth, FROM, TO);
    expect(slaService.getTurnaroundReport).toHaveBeenCalledWith(auth, FROM, TO);
  });
});
