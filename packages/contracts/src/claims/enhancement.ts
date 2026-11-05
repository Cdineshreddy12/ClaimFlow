import { z } from "zod";

/**
 * An enhancement: asking the insurer to raise what it sanctioned,
 * because the treatment outgrew it.
 *
 * This is the claim's most expensive moment. The sanctioned amount is a
 * ceiling on what the insurer will pay, so cost crossing it mid-
 * admission means the hospital eats the difference or asks the patient
 * for cash at the bedside. Either outcome is the one the desk exists to
 * prevent, and it can only be prevented *before* discharge — which is
 * why the alert below is about an open claim, not a report.
 */

export const EnhancementStatus = z.enum([
  "REQUESTED",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);
export type EnhancementStatus = z.infer<typeof EnhancementStatus>;

export const ENHANCEMENT_STATUS_LABEL: Record<EnhancementStatus, string> = {
  REQUESTED: "Awaiting insurer",
  APPROVED: "Approved in full",
  PARTIALLY_APPROVED: "Partly approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** Open means the insurer still owes an answer. */
export function isEnhancementOpen(status: EnhancementStatus): boolean {
  return status === "REQUESTED";
}

export const RequestEnhancementBody = z.object({
  requestedAmount: z.coerce
    .number()
    .positive("Enter an amount above zero")
    .max(100_000_000),
  /**
   * Required, and not a free-text note: this sentence goes to the
   * insurer, who refuses enhancements that don't say what changed
   * clinically. A blank reason is a rejected enhancement.
   */
  reason: z.string().trim().min(1, "Say what changed to need more cover"),
});
export type RequestEnhancementBody = z.infer<typeof RequestEnhancementBody>;

export const DecideEnhancementBody = z
  .object({
    outcome: z.enum([
      "APPROVED",
      "PARTIALLY_APPROVED",
      "REJECTED",
      "WITHDRAWN",
    ]),
    /** What the insurer actually added. Required on any approval, meaningless otherwise. */
    approvedAmount: z.coerce.number().min(0).max(100_000_000).optional(),
  })
  .refine(
    (v) =>
      (v.outcome === "APPROVED" || v.outcome === "PARTIALLY_APPROVED") ===
      (v.approvedAmount !== undefined),
    {
      message:
        "An approval needs the amount granted; a rejection must not carry one",
      path: ["approvedAmount"],
    },
  );
export type DecideEnhancementBody = z.infer<typeof DecideEnhancementBody>;

/**
 * Where a claim's money stands, from the four numbers that actually
 * exist: what the insurer sanctioned, what the hospital expects to
 * spend, what it billed, and what was cut and clawed back after.
 */
export interface ClaimFinancials {
  /** What the insurer authorised, including every approved enhancement. */
  sanctionedAmount: number | null;
  /** The pre-auth form's total expected cost, if a human has confirmed it. */
  expectedCost: number | null;
  billedAmount: number | null;
  deductedAmount: number;
  /** Clawed back on appeal — see the deduction appeal flow. */
  recoveredAmount: number;
  /**
   * What the hospital is out of pocket: billed, less what survived of
   * the sanction, less anything recovered. Null until there is both a
   * sanctioned amount and a bill, because a shortfall against an
   * unknown ceiling is not a number.
   */
  shortfall: number | null;
  /** Cost so far against the ceiling, 0–1+. Null without both. */
  utilisation: number | null;
  enhancement: EnhancementAdvice;
}

export interface EnhancementAdvice {
  /** True when the claim is open, near its ceiling, and nothing is pending. */
  advised: boolean;
  /** Set when an enhancement is already awaiting the insurer. */
  pending: boolean;
  /** How much more is needed to cover the cost on record, when that's knowable. */
  suggestedAmount: number | null;
  reason: string | null;
}

/**
 * When to tell the desk to ask for more cover.
 *
 * 0.8 rather than 1.0 deliberately. An enhancement takes the insurer
 * hours it does not promise, so a request sent the moment cost crosses
 * the ceiling arrives too late to stop a cash demand at discharge. The
 * cost of being early is one phone call; the cost of being late is the
 * patient's problem.
 */
export const ENHANCEMENT_ADVISORY_RATIO = 0.8;

/**
 * Pure, so the API and the UI cannot disagree about whether a claim
 * needs more cover — and so this reasoning is testable without a
 * database.
 */
export function adviseEnhancement(input: {
  sanctionedAmount: number | null;
  /** Highest cost on record: the bill if there is one, else the expected cost. */
  costOnRecord: number | null;
  claimIsOpen: boolean;
  hasPendingEnhancement: boolean;
}): EnhancementAdvice {
  if (input.hasPendingEnhancement) {
    return {
      advised: false,
      pending: true,
      suggestedAmount: null,
      reason: "An enhancement is already with the insurer.",
    };
  }

  const { sanctionedAmount, costOnRecord } = input;
  if (!input.claimIsOpen || !sanctionedAmount || !costOnRecord) {
    return {
      advised: false,
      pending: false,
      suggestedAmount: null,
      reason: null,
    };
  }

  const ratio = costOnRecord / sanctionedAmount;
  if (ratio < ENHANCEMENT_ADVISORY_RATIO) {
    return {
      advised: false,
      pending: false,
      suggestedAmount: null,
      reason: null,
    };
  }

  // Ask for the gap plus the same margin that triggered the advice, so
  // a claim that is still running doesn't come straight back here. Never
  // less than the gap itself.
  const gap = Math.max(costOnRecord - sanctionedAmount, 0);
  const headroom = Math.round(
    sanctionedAmount * (1 - ENHANCEMENT_ADVISORY_RATIO),
  );
  const suggestedAmount = Math.max(gap + headroom, headroom);

  return {
    advised: true,
    pending: false,
    suggestedAmount,
    reason:
      ratio >= 1
        ? "Cost on record has passed the sanctioned amount."
        : `Cost on record is ${Math.round(ratio * 100)}% of the sanctioned amount.`,
  };
}
