import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PeriodReport } from "./reports.service.js";
import { buildPeriodReportPdf, type PeriodReportCover } from "./reports.pdf.js";

const COVER: PeriodReportCover = {
  hospitalName: "City General Hospital",
  hospitalAddress: "12 Station Road, Pune, Maharashtra, 411001",
  rohiniId: "8901234567890",
  periodLabel: "October 2026",
  generatedAt: new Date("2026-11-04T10:00:00Z"),
};

const EMPTY_REPORT: PeriodReport = {
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-11-01T00:00:00Z"),
  claims: { opened: 0, settled: 0, settledValue: 0, avgTatDays: null },
  deductions: { total: 0, avoidableTotal: 0, recoveredTotal: 0, byReason: [] },
  turnaround: { since: new Date("2026-10-01T00:00:00Z"), rows: [] },
};

describe("buildPeriodReportPdf", () => {
  it("produces a readable PDF with nothing to report yet", async () => {
    const bytes = await buildPeriodReportPdf(COVER, EMPTY_REPORT);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("spills onto another page rather than overlapping the margin", async () => {
    const manyInsurers: PeriodReport = {
      ...EMPTY_REPORT,
      turnaround: {
        since: EMPTY_REPORT.from,
        rows: Array.from({ length: 60 }, (_, i) => ({
          insurerName: `Insurer ${i}`,
          fromStatus: "PRE_AUTH_SENT" as const,
          decisions: 10,
          avgHours: 2.5,
          worstHours: 9,
          breaches: 1,
          targetHours: 1,
          breachRate: 0.1,
        })),
      },
    };

    const bytes = await buildPeriodReportPdf(COVER, manyInsurers);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
