import type { Role } from "@claimflow/contracts";
import * as deductionsService from "../deductions/deductions.service.js";
import type { DeductionsSummary } from "../deductions/deductions.service.js";
import * as slaService from "../sla/sla.service.js";
import type { TurnaroundReport } from "../sla/sla.service.js";
import * as repo from "./reports.repository.js";
import type { PeriodClaimsSummary } from "./reports.repository.js";

interface AuthContext {
  userId: string;
  role: Role;
}

export interface PeriodReport {
  from: Date;
  to: Date;
  claims: PeriodClaimsSummary;
  deductions: DeductionsSummary;
  turnaround: TurnaroundReport;
}

/**
 * One hospital month, for forwarding to the person who signs the deal
 * but never logs in — see docs/adr/0018.
 *
 * This computes nothing new. The claims summary aside, both other
 * pieces already exist for other screens (deductions-by-reason on the
 * dashboard, insurer turnaround on the Turnaround page); this module
 * closes their open-ended "since X" windows into one shared [from, to)
 * and hands all three back together.
 */
export async function getPeriodReport(
  auth: AuthContext,
  from: Date,
  to: Date,
): Promise<PeriodReport> {
  const [claims, deductions, turnaround] = await Promise.all([
    repo.periodClaimsSummary(from, to),
    deductionsService.summarise(auth, from, to),
    slaService.getTurnaroundReport(auth, from, to),
  ]);

  return { from, to, claims, deductions, turnaround };
}
