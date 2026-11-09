import { inflateSync } from "node:zlib";
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
  turnaround: { since: new Date("2026-10-01T00:00:00Z"), rows: [], desk: [] },
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
        desk: [],
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

  /*
    This report carried the hospital's logo, tagline and accent but
    ignored `accentHeadings`, so a desk that turned the accent on got
    teal section names on the pre-auth form and black ones here — the
    exact one-PDF-not-the-other mismatch this builder exists to end.

    Counting fill-colour operators rather than reading pixels: the
    accent is set once for the title whatever the setting, and again
    for each section name only when it is on.
  */
  /** Every flate stream in the file, inflated — pdf-lib compresses them. */
  const contentOf = (bytes: Uint8Array): string => {
    const buf = Buffer.from(bytes);
    let out = "";
    for (let i = 0; ;) {
      const start = buf.indexOf("stream", i);
      if (start === -1) break;
      const end = buf.indexOf("endstream", start);
      if (end === -1) break;
      let from = start + "stream".length;
      while (buf[from] === 0x0d || buf[from] === 0x0a) from++;
      try {
        out += `${inflateSync(buf.subarray(from, end)).toString("latin1")}\n`;
      } catch {
        // Not a flate stream — an embedded font or image. Skip it.
      }
      i = end + "endstream".length;
    }
    return out;
  };

  /** #0E7C86 as a PDF fill-colour operator, at pdf-lib's precision. */
  const TEAL_FILL = `${0x0e / 255} ${0x7c / 255} ${0x86 / 255} rg`;
  const accentFills = (bytes: Uint8Array): number =>
    contentOf(bytes).split(TEAL_FILL).length - 1;

  it("colours the section names only when accentHeadings is on", async () => {
    const teal = { ...COVER, accentColorHex: "#0E7C86" };

    const off = await buildPeriodReportPdf(
      { ...teal, options: { accentHeadings: false } },
      EMPTY_REPORT,
    );
    const on = await buildPeriodReportPdf(
      { ...teal, options: { accentHeadings: true } },
      EMPTY_REPORT,
    );

    // The title takes the accent either way, so neither is zero.
    expect(accentFills(off)).toBeGreaterThan(0);
    // "Deductions by reason" and "Insurer turnaround" add two more.
    expect(accentFills(on)).toBe(accentFills(off) + 2);
  });

  it("leaves the headings alone when no accent is set", async () => {
    const bytes = await buildPeriodReportPdf(
      { ...COVER, options: { accentHeadings: true } },
      EMPTY_REPORT,
    );
    expect(accentFills(bytes)).toBe(0);
  });
});
