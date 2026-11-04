import {
  AVOIDABLE_DEDUCTION_REASONS,
  DeductionReason,
  type RecordDeductionBody,
  type Role,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import { getOrgMemberId } from "../org-members/org-members.repository.js";
import * as repo from "./deductions.repository.js";

export class ClaimNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

export async function recordDeduction(
  auth: AuthContext,
  claimId: string,
  body: RecordDeductionBody,
) {
  const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
  const created = await repo.create(
    auth.organizationId,
    claimId,
    { reason: body.reason, amount: body.amount, note: body.note || undefined },
    memberId,
  );
  if (!created) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "deduction.recorded",
    entityType: "claim",
    entityId: claimId,
    after: { reason: body.reason, amount: body.amount },
    actorId: memberId,
  });

  return created;
}

export async function listForClaim(auth: AuthContext, claimId: string) {
  const result = await repo.listForClaim(auth.organizationId, claimId);
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

export interface DeductionsSummary {
  total: number;
  /** The share the desk could actually have prevented — the number the 40% target tracks. */
  avoidableTotal: number;
  byReason: { reason: DeductionReason; total: number; count: number }[];
}

/**
 * Totals for the dashboard, defaulting to the current calendar month —
 * "deductions this month" is how the client already talks about it.
 */
export async function summarise(
  auth: AuthContext,
  since: Date,
): Promise<DeductionsSummary> {
  const rows = await repo.sumByReasonSince(auth.organizationId, since);

  const byReason = rows
    .map((row) => {
      // Rows predate any later change to the enum, so an unrecognised
      // reason is possible — bucket it rather than crash the dashboard.
      const parsed = DeductionReason.safeParse(row.reason);
      const reason: DeductionReason = parsed.success ? parsed.data : "other";
      // No label here — the client maps it via DEDUCTION_REASON_LABEL
      // from contracts, so the wording lives in exactly one place.
      return { reason, total: Number(row.total), count: row.count };
    })
    .sort((a, b) => b.total - a.total);

  return {
    total: byReason.reduce((sum, r) => sum + r.total, 0),
    avoidableTotal: byReason
      .filter((r) => AVOIDABLE_DEDUCTION_REASONS.includes(r.reason))
      .reduce((sum, r) => sum + r.total, 0),
    byReason,
  };
}
