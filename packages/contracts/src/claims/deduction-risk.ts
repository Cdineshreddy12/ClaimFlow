import {
  AVOIDABLE_DEDUCTION_REASONS,
  type DeductionReason,
} from "./deductions.js";

/**
 * What this hospital's own settlement history says is likely to be cut
 * from *this* claim, and what that cost last time.
 *
 * Deliberately not a model and deliberately not a score. Every number
 * below is a count or a sum over rows the desk entered itself, so a
 * warning can be argued with: "seven of your last twelve Star Health
 * cholecystectomies lost money to a missing document" is checkable, and
 * a 73/100 risk score is not. Same principle as docs/adr/0005 — the
 * desk has to be able to tell when we're wrong.
 */

/**
 * Settled claims needed in scope before any rate is shown.
 *
 * Below this, a single bad claim reads as "100% of your history" and
 * burns the credibility of every later warning. Silence is the honest
 * output for a hospital that just started.
 */
export const MIN_HISTORY_CLAIMS = 3;

/**
 * Settled claims needed at (insurer + procedure) before that narrow
 * scope is preferred over all claims with the insurer. The narrow scope
 * is far more useful — insurers cut different things on different
 * procedures — but it runs thin first.
 */
export const PROCEDURE_SCOPE_MIN_CLAIMS = 5;

/** Which slice of history a warning was computed over. The UI must say which. */
export type DeductionRiskScope = "insurer_procedure" | "insurer";

export interface DeductionRisk {
  reason: DeductionReason;
  /** Whether the desk can actually prevent this one — see AVOIDABLE_DEDUCTION_REASONS. */
  avoidable: boolean;
  /** Settled claims in scope that lost money to this reason. */
  claimsAffected: number;
  /** Out of this many settled claims in scope. Always rendered with the number above. */
  claimsConsidered: number;
  /** Rupees cut for this reason across those claims, before any appeal. */
  historicalTotal: number;
  /** Clawed back on appeal, out of that total (docs/adr/0013). */
  recoveredTotal: number;
  /** What it actually cost: cut, less recovered. The number that ranks. */
  netTotal: number;
  /** Mean *net* loss per affected claim — what one recurrence actually costs. */
  averagePerClaim: number;
  /**
   * `(claimsAffected / claimsConsidered) × averagePerClaim`. Ranking
   * only, never shown as a prediction: it's an average of the past, not
   * a forecast for this patient.
   */
  expectedCost: number;
  /**
   * Required checklist slots missing on this claim *right now* that this
   * reason is historically about. Only ever populated for
   * `missing_document`, where the history and the live gap are the same
   * fact — that join is the point of the feature.
   */
  openGaps: string[];
}

export interface DeductionRiskAssessment {
  scope: DeductionRiskScope;
  /** Settled claims the assessment was computed over, at the scope above. */
  claimsConsidered: number;
  /** False when there isn't enough settled history to say anything honest; `risks` is then empty. */
  enoughHistory: boolean;
  /** Ranked: preventable reasons first, then by expected cost. */
  risks: DeductionRisk[];
}

export function isAvoidableReason(reason: DeductionReason): boolean {
  return AVOIDABLE_DEDUCTION_REASONS.includes(reason);
}
