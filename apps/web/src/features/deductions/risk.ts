import {
  DEDUCTION_REASON_LABEL,
  type DeductionRisk,
  type DeductionRiskScope,
} from "@claimflow/contracts";

/**
 * The sentences the risk panel renders.
 *
 * Kept out of the component because each one is a claim about the
 * hospital's own money, and the wording is the part that decides
 * whether the desk trusts the panel or learns to dismiss it. Testable
 * in isolation, therefore tested.
 */

/** "7 of the last 12" — the denominator is never dropped. */
export function formatRate(risk: DeductionRisk): string {
  return `${risk.claimsAffected} of the last ${risk.claimsConsidered}`;
}

/** Whole percent. Decimals on a count of twelve claims imply a precision we don't have. */
export function formatRatePercent(risk: DeductionRisk): string {
  if (risk.claimsConsidered === 0) return "—";
  return `${Math.round((risk.claimsAffected / risk.claimsConsidered) * 100)}%`;
}

/**
 * Says which slice of history this came from, in the desk's own terms.
 *
 * The narrow scope is the credible one, so when we had to widen, the
 * copy has to admit it rather than let "Star Health cuts this" stand
 * for "Star Health cuts this on this procedure".
 */
export function describeScope(
  scope: DeductionRiskScope,
  insurerName: string,
  procedureName: string,
): string {
  return scope === "insurer_procedure"
    ? `${insurerName} · ${procedureName}`
    : `${insurerName}, all procedures`;
}

/**
 * What to actually do about it. Only `missing_document` can point at
 * something on this claim; the rest are habits, not items, so they get
 * the habit stated plainly instead of a fake call to action.
 */
export function riskAction(risk: DeductionRisk): string | null {
  if (risk.openGaps.length > 0) {
    return risk.openGaps.length === 1
      ? `Still missing: ${risk.openGaps[0]}`
      : `Still missing: ${risk.openGaps.join(", ")}`;
  }

  switch (risk.reason) {
    case "missing_document":
      // History says they cut for this, but the checklist is complete —
      // so the warning is informational and must not imply otherwise.
      return "Checklist is complete — no gaps to close.";
    case "documentation_delay":
      return "Submit before the deadline; this insurer has cut for late paperwork.";
    case "incomplete_clinical_notes":
      return "Have the treating doctor expand the clinical notes before you send.";
    default:
      return null;
  }
}

export function reasonLabel(risk: DeductionRisk): string {
  return DEDUCTION_REASON_LABEL[risk.reason];
}

/**
 * Whether a risk is worth interrupting someone over.
 *
 * Preventable, recurring in at least a third of past claims, and still
 * open on this one. Everything else stays in the panel but doesn't
 * raise the header's alarm — a card that shouts about all five reasons
 * shouts about nothing.
 */
export function isUrgent(risk: DeductionRisk): boolean {
  if (!risk.avoidable) return false;
  if (risk.claimsConsidered === 0) return false;
  const rate = risk.claimsAffected / risk.claimsConsidered;
  if (rate < 1 / 3) return false;
  return risk.reason !== "missing_document" || risk.openGaps.length > 0;
}
