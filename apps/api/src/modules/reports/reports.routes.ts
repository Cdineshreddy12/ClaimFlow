import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as hospitalRepository from "../hospital/hospital.repository.js";
import * as service from "./reports.service.js";
import { buildPeriodReportPdf } from "./reports.pdf.js";
import { fetchLogo } from "../../lib/pdf-letterhead.js";
import { getObjectBytes } from "../../integrations/storage/s3.js";

/** "2026-10" — a calendar month, the unit the client already reports deductions in. */
const MonthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The [from, to) bounds of the given "YYYY-MM", or the current calendar month if omitted. */
function monthBounds(month: string | undefined): { from: Date; to: Date } {
  const now = new Date();
  const [year, mon] = month
    ? month.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const from = new Date(Date.UTC(year!, mon! - 1, 1));
  const to = new Date(Date.UTC(year!, mon!, 1));
  return { from, to };
}

function periodLabel(from: Date): string {
  return `${MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
}

function formatAddress(hospital: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string {
  return [
    hospital.addressLine1,
    hospital.addressLine2,
    hospital.city,
    hospital.state,
    hospital.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The CFO report — a closed month's claim volume, deductions and
 * insurer turnaround, for a desk head to forward to whoever signs the
 * deal but has no login here (docs/adr/0018).
 */
export async function registerReportsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("org_admin", "desk_head"));

  app.get("/period", async (request, reply) => {
    const { month } = MonthQuery.parse(request.query);
    const { from, to } = monthBounds(month);
    return reply.send(
      await service.getPeriodReport(request.authUser!, from, to),
    );
  });

  app.get("/period.pdf", async (request, reply) => {
    const { month } = MonthQuery.parse(request.query);
    const { from, to } = monthBounds(month);
    const [report, hospital] = await Promise.all([
      service.getPeriodReport(request.authUser!, from, to),
      hospitalRepository.get(),
    ]);

    const bytes = await buildPeriodReportPdf(
      {
        hospitalName: hospital?.name ?? "ClaimFlow",
        hospitalAddress: hospital ? formatAddress(hospital) : "",
        rohiniId: hospital?.rohiniId ?? null,
        periodLabel: periodLabel(from),
        generatedAt: new Date(),
        // The same branding the pre-auth form carries. This is the
        // other document that leaves the building.
        registrationNumber: hospital?.registrationNumber ?? null,
        tagline: hospital?.tagline ?? null,
        accentColorHex: hospital?.brandAccentColor ?? null,
        footerNote: hospital?.documentFooterNote ?? null,
        options: hospital?.preauthOptions,
        logo: await fetchLogo(hospital?.logoFileKey, getObjectBytes),
      },
      report,
    );

    return reply
      .header("content-type", "application/pdf")
      .header(
        "content-disposition",
        `attachment; filename="claimflow-report-${from.toISOString().slice(0, 7)}.pdf"`,
      )
      .send(Buffer.from(bytes));
  });
}
