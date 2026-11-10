import {
  appealOutcomeFor,
  AVOIDABLE_DEDUCTION_REASONS,
  DeductionReason,
  isAppealOpen,
  isAvoidableReason,
  MIN_HISTORY_CLAIMS,
  PROCEDURE_SCOPE_MIN_CLAIMS,
  type DeductionRisk,
  type DeductionRiskAssessment,
  type DeductionRiskScope,
  type ContestDeductionBody,
  type DeductionAppealStatus,
  type RecordDeductionBody,
  type ResolveAppealBody,
  type Role,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import { getClaimGaps } from "../claims/claims.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as repo from "./deductions.repository.js";

export class ClaimNotFoundError extends Error {}
export class DeductionNotFoundError extends Error {}
export class AppealAlreadyOpenError extends Error {}
export class AppealAlreadyResolvedError extends Error {}
/** Getting back more than was cut isn't a generous insurer, it's a typo. */
export class RecoveryExceedsDeductionError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

export class DeductionsExceedBillError extends Error {}

export async function recordDeduction(
  auth: AuthContext,
  claimId: string,
  body: RecordDeductionBody,
) {
  /*
    The cuts cannot come to more than the bill. Only checked once the
    bill is known: before that there is nothing to measure against, and
    refusing would be worse than allowing.
  */
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const billed =
    claim.billedAmount === null ? null : Number(claim.billedAmount);
  if (billed !== null) {
    const { deducted } = await repo.totalsForClaim(claimId);
    const total = deducted + body.amount;
    if (total > billed) {
      throw new DeductionsExceedBillError(
        `deductions would come to ${total.toLocaleString("en-IN")}, more than the ${billed.toLocaleString("en-IN")} billed`,
      );
    }
  }

  const memberId = await getMemberId(auth.userId);
  const created = await repo.create(
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
  const result = await repo.listForClaim(claimId);
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

export interface DeductionsSummary {
  total: number;
  /** The share the desk could actually have prevented — the number the 40% target tracks. */
  avoidableTotal: number;
  /** Clawed back on appeal in the same window (docs/adr/0013). */
  recoveredTotal: number;
  byReason: {
    reason: DeductionReason;
    total: number;
    count: number;
    recovered: number;
  }[];
}

/**
 * Totals for the dashboard, defaulting to the current calendar month —
 * "deductions this month" is how the client already talks about it.
 *
 * `until` is open-ended unless given — the dashboard wants "so far";
 * the period report (docs/adr/0018) passes both ends for a closed month.
 */
export async function summarise(
  auth: AuthContext,
  since: Date,
  until?: Date,
): Promise<DeductionsSummary> {
  const rows = await repo.sumByReasonSince(since, until);

  const byReason = rows
    .map((row) => {
      // Rows predate any later change to the enum, so an unrecognised
      // reason is possible — bucket it rather than crash the dashboard.
      const parsed = DeductionReason.safeParse(row.reason);
      const reason: DeductionReason = parsed.success ? parsed.data : "other";
      // No label here — the client maps it via DEDUCTION_REASON_LABEL
      // from contracts, so the wording lives in exactly one place.
      return {
        reason,
        total: Number(row.total),
        count: row.count,
        recovered: Number(row.recovered),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    total: byReason.reduce((sum, r) => sum + r.total, 0),
    avoidableTotal: byReason
      .filter((r) => AVOIDABLE_DEDUCTION_REASONS.includes(r.reason))
      .reduce((sum, r) => sum + r.total, 0),
    recoveredTotal: byReason.reduce((sum, r) => sum + r.recovered, 0),
    byReason,
  };
}

/**
 * What this hospital's own history says is likely to be cut from this
 * claim, while there is still time to prevent it.
 *
 * The product's premise is that most deducted money is avoidable
 * paperwork, and the deduction reasons were chosen to match that. This
 * closes the loop: the same reasons, read back at the claim that is
 * about to repeat them.
 *
 * No model is involved. Counts and sums over rows the desk entered
 * itself, so every warning carries the evidence that produced it and
 * can be argued with.
 */
export async function assessRisk(
  auth: AuthContext,
  claimId: string,
): Promise<DeductionRiskAssessment> {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  // Prefer what this insurer does to this procedure. Fall back to the
  // insurer alone when that's too thin to mean anything — a wider slice
  // of real history beats a narrow slice of noise, and the response
  // says which one it used so the UI can't imply the narrow one.
  let scope: DeductionRiskScope = "insurer_procedure";
  let history = await repo.settledHistoryForScope({
    insurerId: claim.insurerId,
    procedureId: claim.procedureId,
    excludeClaimId: claimId,
  });

  if (history.claimsConsidered < PROCEDURE_SCOPE_MIN_CLAIMS) {
    const wider = await repo.settledHistoryForScope({
      insurerId: claim.insurerId,
      excludeClaimId: claimId,
    });
    if (wider.claimsConsidered > history.claimsConsidered) {
      scope = "insurer";
      history = wider;
    }
  }

  const { claimsConsidered } = history;
  if (claimsConsidered < MIN_HISTORY_CLAIMS) {
    return { scope, claimsConsidered, enoughHistory: false, risks: [] };
  }

  // Only fetched when there's history worth cross-referencing it against.
  const gaps = await getClaimGaps(auth, claimId);

  const risks: DeductionRisk[] = history.byReason
    .map((row) => {
      const parsed = DeductionReason.safeParse(row.reason);
      const reason: DeductionReason = parsed.success ? parsed.data : "other";
      // A reason with no affected claims can't come back from the query,
      // but dividing by it would be silent nonsense if it ever did.
      const affected = Math.max(row.claimsAffected, 1);
      // Net, not gross. A reason this insurer cuts often but gives back
      // on appeal is a smaller risk than its gross total implies, and
      // ranking on gross would send the desk chasing the wrong one.
      const netTotal = Math.max(row.total - row.recovered, 0);
      const averagePerClaim = netTotal / affected;
      return {
        reason,
        avoidable: isAvoidableReason(reason),
        claimsAffected: row.claimsAffected,
        claimsConsidered,
        historicalTotal: row.total,
        recoveredTotal: row.recovered,
        netTotal,
        averagePerClaim,
        expectedCost: (row.claimsAffected / claimsConsidered) * averagePerClaim,
        // The live join: history says this insurer cuts for missing
        // documents, and the claim is missing documents right now. Any
        // other reason has no equivalent on-claim fact to point at, so
        // it stays empty rather than guessing at one.
        openGaps: reason === "missing_document" ? gaps.missing : [],
      };
    })
    // Preventable first, then by what it costs. Sorting purely by money
    // would let a policy mismatch — which the desk cannot do anything
    // about — head a panel whose entire job is to be acted on.
    .sort(
      (a, b) =>
        Number(b.avoidable) - Number(a.avoidable) ||
        b.expectedCost - a.expectedCost,
    );

  return { scope, claimsConsidered, enoughHistory: true, risks };
}

/**
 * Opens an appeal against one deduction.
 *
 * Contesting is the point of docs/adr/0013: knowing what was cut only
 * becomes money if something is done about it. Recording the attempt is
 * what makes the next step — and the recovery rate — visible at all.
 */
export async function contestDeduction(
  auth: AuthContext,
  deductionId: string,
  body: ContestDeductionBody,
) {
  const existing = await repo.getById(deductionId);
  if (!existing) throw new DeductionNotFoundError(deductionId);
  if (existing.appealStatus !== "NOT_CONTESTED") {
    throw new AppealAlreadyOpenError(
      `this deduction is already ${existing.appealStatus}`,
    );
  }

  const updated = await repo.contest(deductionId, body.note || undefined);
  if (!updated) throw new DeductionNotFoundError(deductionId);

  const memberId = await getMemberId(auth.userId);
  await auditService.record(auth, {
    action: "deduction.contested",
    entityType: "claim",
    entityId: existing.claimId,
    after: { deductionId, amount: existing.amount, reason: existing.reason },
    actorId: memberId,
  });

  return updated;
}

/**
 * Records what the insurer gave back.
 *
 * The outcome is derived from the amount rather than chosen, and a
 * recovery can never exceed what was cut: the appeal is an argument
 * about one deduction, so getting back more than it took isn't a
 * generous insurer, it's a typo.
 */
export async function resolveAppeal(
  auth: AuthContext,
  deductionId: string,
  body: ResolveAppealBody,
) {
  const existing = await repo.getById(deductionId);
  if (!existing) throw new DeductionNotFoundError(deductionId);
  if (!isAppealOpen(existing.appealStatus)) {
    throw new AppealAlreadyResolvedError(
      `this appeal was already ${existing.appealStatus}`,
    );
  }

  const deducted = Number(existing.amount);
  if (body.recoveredAmount > deducted) {
    throw new RecoveryExceedsDeductionError(
      `recovered ${body.recoveredAmount} is more than the ${deducted} deducted`,
    );
  }

  const outcome = appealOutcomeFor(deducted, body.recoveredAmount);
  const updated = await repo.resolveAppeal(
    deductionId,
    outcome,
    body.recoveredAmount,
    body.note || undefined,
  );
  if (!updated) throw new DeductionNotFoundError(deductionId);

  const memberId = await getMemberId(auth.userId);
  await auditService.record(auth, {
    action: "deduction.appeal_resolved",
    entityType: "claim",
    entityId: existing.claimId,
    before: { appealStatus: existing.appealStatus },
    after: {
      deductionId,
      appealStatus: outcome,
      recovered: body.recoveredAmount,
    },
    actorId: memberId,
  });

  return updated;
}

export async function listAppealWorklist(
  auth: AuthContext,
  filters: { status?: DeductionAppealStatus },
) {
  return repo.listAppealWorklist(filters);
}
