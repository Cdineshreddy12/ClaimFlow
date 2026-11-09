import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { DEDUCTION_REASON_LABEL, preauthOptions } from "@claimflow/contracts";
import { drawLetterhead, wrapText } from "../../lib/pdf-letterhead.js";
import type { PeriodReport } from "./reports.service.js";

export interface PeriodReportCover {
  hospitalName: string;
  hospitalAddress: string;
  rohiniId: string | null;
  /** "October 2026" — the calendar month this report covers. */
  periodLabel: string;
  generatedAt: Date;
  /**
   * The same branding the pre-auth form carries.
   *
   * This report is the other thing a hospital forwards to someone
   * outside the building, and it had none of it — a desk head who had
   * set a logo and an accent saw them on one PDF and not the other.
   */
  registrationNumber?: string | null;
  tagline?: string | null;
  accentColorHex?: string | null;
  footerNote?: string | null;
  logo?:
    | { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" }
    | null
    | undefined;
  /** Typeface and logo placement, as stored. Null reads as all-defaults. */
  options?: unknown;
}

/**
 * Readable label for the decision a turnaround row measures. Mirrors
 * apps/web/src/features/sla/labels.ts#CLAIM_STATUS_LABELS — kept as its
 * own three-entry copy here rather than shared, since it's a PDF
 * caption, not a business rule.
 */
const DECISION_LABEL: Record<string, string> = {
  PRE_AUTH_SENT: "Cashless decision",
  FINAL_BILL_SUBMITTED: "Discharge authorisation",
  ENHANCEMENT_REQUESTED: "Enhancement decision",
};

/** "#RRGGBB" → pdf-lib's rgb(), or null for anything that doesn't parse. */
function hexToColor(hex: string | null | undefined) {
  const match = hex ? /^#?([0-9a-fA-F]{6})$/.exec(hex.trim()) : null;
  if (!match?.[1]) return null;
  const n = parseInt(match[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

function formatInr(amount: number): string {
  return `INR ${Math.round(amount).toLocaleString("en-IN")}`;
}

/**
 * Tracks the current page and y-offset across both tables, starting a
 * fresh page rather than letting a table run into the margin or off the
 * page — a report with one row driven below the fold is wrong in the
 * one way that's hardest to notice.
 */
function makeCursor(doc: PDFDocument) {
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  function ensure(space: number) {
    if (y - space < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  }

  return {
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
    ensure,
  };
}

function drawTableHeader(
  cursor: ReturnType<typeof makeCursor>,
  columns: { label: string; x: number; align?: "right" }[],
  bold: PDFFont,
  faint: ReturnType<typeof rgb>,
) {
  cursor.ensure(28);
  for (const col of columns) {
    cursor.page.drawText(col.label, {
      x: col.x,
      y: cursor.y,
      size: 9,
      font: bold,
      color: faint,
    });
  }
  cursor.y -= 6;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: A4[0] - MARGIN, y: cursor.y },
    thickness: 0.75,
    color: faint,
  });
  cursor.y -= 16;
}

function drawRow(
  cursor: ReturnType<typeof makeCursor>,
  cells: { text: string; x: number; align?: "right" }[],
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  cursor.ensure(18);
  for (const cell of cells) {
    const size = 9.5;
    const x =
      cell.align === "right"
        ? cell.x - font.widthOfTextAtSize(cell.text, size)
        : cell.x;
    cursor.page.drawText(cell.text, { x, y: cursor.y, size, font, color });
  }
  cursor.y -= 16;
}

/**
 * Renders one hospital month into a PDF a desk head can forward — the
 * one artifact that reaches the person who signs the deal but never
 * logs in (docs/adr/0018).
 *
 * Same letterhead-plus-tables approach as packet.builder.ts, reusing
 * its margins and A4 constant rather than inventing a second layout
 * language for one more PDF.
 */
export async function buildPeriodReportPdf(
  cover: PeriodReportCover,
  report: PeriodReport,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`ClaimFlow — ${cover.periodLabel} report`);
  doc.setProducer("ClaimFlow");
  doc.setCreationDate(cover.generatedAt);

  const options = preauthOptions(cover.options);
  const serif = options.typeface === "serif";
  const bold = await doc.embedFont(
    serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold,
  );
  const regular = await doc.embedFont(
    serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica,
  );
  const ink = rgb(0.11, 0.106, 0.09);
  const faint = rgb(0.56, 0.56, 0.52);
  const critical = rgb(0.62, 0.17, 0.14);
  const accent = hexToColor(cover.accentColorHex) ?? ink;
  // The same switch the pre-auth form reads, so a desk that turns the
  // accent on gets it on both documents rather than on whichever one
  // happened to be written second.
  const headings = options.accentHeadings ? accent : ink;

  const cursor = makeCursor(doc);

  cursor.y = await drawLetterhead(
    doc,
    cursor.page,
    {
      name: cover.hospitalName,
      address: cover.hospitalAddress,
      tagline: cover.tagline,
      ids: [
        cover.rohiniId ? `ROHINI ID ${cover.rohiniId}` : null,
        cover.registrationNumber ? `Reg. ${cover.registrationNumber}` : null,
      ].filter((id): id is string => id !== null),
      logo: cover.logo,
      logoPlacement: options.logoPlacement,
    },
    { bold, regular, nameSize: 18 },
    { margin: MARGIN, pageWidth: A4[0], top: cursor.y },
  );

  cursor.y -= 28;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: A4[0] - MARGIN, y: cursor.y },
    thickness: 1,
    color: faint,
  });
  cursor.y -= 30;

  cursor.page.drawText(`Desk report — ${cover.periodLabel}`, {
    x: MARGIN,
    y: cursor.y,
    size: 13,
    font: bold,
    color: accent,
  });
  cursor.y -= 10;
  cursor.page.drawText(
    `Generated ${cover.generatedAt.toISOString().replace("T", " ").slice(0, 16)}`,
    { x: MARGIN, y: cursor.y - 10, size: 8, font: regular, color: faint },
  );
  cursor.y -= 34;

  // --- KPIs ---
  const kpis: [string, string][] = [
    ["Claims opened", String(report.claims.opened)],
    ["Claims settled", String(report.claims.settled)],
    ["Settled value", formatInr(report.claims.settledValue)],
    [
      "Average turnaround",
      report.claims.avgTatDays != null
        ? `${report.claims.avgTatDays.toFixed(1)} days`
        : "No claims settled",
    ],
  ];
  for (const [label, value] of kpis) {
    cursor.ensure(19);
    cursor.page.drawText(label, {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: regular,
      color: faint,
    });
    cursor.page.drawText(value, {
      x: MARGIN + 160,
      y: cursor.y,
      size: 10,
      font: bold,
      color: ink,
    });
    cursor.y -= 19;
  }

  // --- deductions by reason ---
  cursor.y -= 18;
  cursor.ensure(24);
  cursor.page.drawText("Deductions by reason", {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: headings,
  });
  cursor.y -= 22;

  /*
    Right edges, with room between them.

    Count sat left-aligned at +220 and Amount right-aligned at +280 —
    sixty points apart, which an amount like "INR 2,10,000" eats
    entirely. It printed as "1INR 2,10,000", the count and the figure
    on top of each other.
  */
  const dedCols = [
    { x: MARGIN },
    { x: MARGIN + 250, align: "right" as const },
    { x: MARGIN + 370, align: "right" as const },
    { x: A4[0] - MARGIN, align: "right" as const },
  ];
  drawTableHeader(
    cursor,
    [
      { label: "Reason", x: dedCols[0]!.x },
      { label: "Count", x: dedCols[1]!.x, align: "right" },
      { label: "Amount", x: dedCols[2]!.x, align: "right" },
      { label: "Recovered", x: dedCols[3]!.x, align: "right" },
    ],
    bold,
    faint,
  );

  if (report.deductions.byReason.length === 0) {
    drawRow(
      cursor,
      [{ text: "No deductions in this period", x: MARGIN }],
      regular,
      faint,
    );
  }
  for (const row of report.deductions.byReason) {
    drawRow(
      cursor,
      [
        { text: DEDUCTION_REASON_LABEL[row.reason], x: dedCols[0]!.x },
        { text: String(row.count), x: dedCols[1]!.x, align: "right" },
        { text: formatInr(row.total), x: dedCols[2]!.x, align: "right" },
        { text: formatInr(row.recovered), x: dedCols[3]!.x, align: "right" },
      ],
      regular,
      ink,
    );
  }
  cursor.y -= 4;
  drawRow(
    cursor,
    [
      { text: "Total", x: dedCols[0]!.x },
      {
        text: formatInr(report.deductions.total),
        x: dedCols[2]!.x,
        align: "right",
      },
      {
        text: formatInr(report.deductions.recoveredTotal),
        x: dedCols[3]!.x,
        align: "right",
      },
    ],
    bold,
    ink,
  );

  /*
    The avoidable share is a note about the total, not a column of it.

    It was drawn into the Count cell — a hundred-point string in a
    sixty-point gap — and printed straight through the amount beside
    it. It reads better underneath anyway: it is the one number on this
    page a desk head can actually do something about.
  */
  if (report.deductions.total > 0) {
    cursor.ensure(16);
    cursor.page.drawText(
      `of which ${formatInr(report.deductions.avoidableTotal)} avoidable`,
      { x: MARGIN, y: cursor.y, size: 8.5, font: regular, color: critical },
    );
    cursor.y -= 16;
  }

  // --- insurer turnaround ---
  cursor.y -= 22;
  cursor.ensure(24);
  cursor.page.drawText("Insurer turnaround", {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: bold,
    color: headings,
  });
  cursor.y -= 22;

  const taCols = [
    { x: MARGIN },
    { x: MARGIN + 150 },
    { x: MARGIN + 280, align: "right" as const },
    { x: MARGIN + 350, align: "right" as const },
    { x: A4[0] - MARGIN, align: "right" as const },
  ];
  drawTableHeader(
    cursor,
    [
      { label: "Insurer", x: taCols[0]!.x },
      { label: "Decision", x: taCols[1]!.x },
      { label: "Average", x: taCols[2]!.x, align: "right" },
      { label: "Target", x: taCols[3]!.x, align: "right" },
      { label: "Past target", x: taCols[4]!.x, align: "right" },
    ],
    bold,
    faint,
  );

  if (report.turnaround.rows.length === 0) {
    drawRow(
      cursor,
      [{ text: "No answered requests in this period", x: MARGIN }],
      regular,
      faint,
    );
  }
  for (const row of report.turnaround.rows) {
    const breachPct = `${Math.round(row.breachRate * 100)}%`;
    drawRow(
      cursor,
      [
        { text: row.insurerName, x: taCols[0]!.x },
        {
          text: DECISION_LABEL[row.fromStatus] ?? row.fromStatus,
          x: taCols[1]!.x,
        },
        {
          text: `${row.avgHours.toFixed(1)}h`,
          x: taCols[2]!.x,
          align: "right",
        },
        {
          text: row.targetHours != null ? `${row.targetHours}h` : "—",
          x: taCols[3]!.x,
          align: "right",
        },
        { text: breachPct, x: taCols[4]!.x, align: "right" },
      ],
      regular,
      row.breachRate > 0 ? critical : ink,
    );
  }

  // Bank details, a closing line — the same note the pre-auth form
  // carries, on the other document that leaves the building.
  if (cover.footerNote) {
    cursor.y -= 24;
    for (const line of wrapText(
      cover.footerNote,
      regular,
      8,
      A4[0] - MARGIN * 2,
    )) {
      cursor.ensure(10);
      cursor.page.drawText(line, {
        x: MARGIN,
        y: cursor.y,
        size: 8,
        font: regular,
        color: faint,
      });
      cursor.y -= 10;
    }
  }

  // Stamped at the end, when the page count is known, and on every
  // page — a report that arrives as loose sheets has no other way to
  // say which is which.
  if (options.pageNumbers) {
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      const text = `Page ${i + 1} of ${pages.length}`;
      p.drawText(text, {
        x: A4[0] - MARGIN - regular.widthOfTextAtSize(text, 7.5),
        y: MARGIN - 20,
        size: 7.5,
        font: regular,
        color: faint,
      });
    });
  }

  return doc.save();
}
