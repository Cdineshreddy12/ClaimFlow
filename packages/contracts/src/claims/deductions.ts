import { z } from "zod";

/**
 * Why an insurer paid less than was billed. These four come from the
 * client's own analysis of where the money actually goes — the whole
 * premise of the product is that most of it is avoidable paperwork, not
 * clinical dispute, so the reasons are deliberately about process.
 *
 * `other` exists because a fixed list that can't express reality gets
 * mis-categorised into whichever option is nearest, which is worse than
 * an honest bucket — it needs a note to be useful.
 */
export const DeductionReason = z.enum([
  "missing_document",
  "documentation_delay",
  "incomplete_clinical_notes",
  "policy_mismatch",
  "other",
]);
export type DeductionReason = z.infer<typeof DeductionReason>;

export const DEDUCTION_REASON_LABEL: Record<DeductionReason, string> = {
  missing_document: "Missing document",
  documentation_delay: "Documentation delay",
  incomplete_clinical_notes: "Incomplete clinical notes",
  policy_mismatch: "Policy mismatch",
  other: "Other",
};

/** The reasons the desk can actually prevent — what the 40%-reduction target is measured against. */
export const AVOIDABLE_DEDUCTION_REASONS: DeductionReason[] = [
  "missing_document",
  "documentation_delay",
  "incomplete_clinical_notes",
];

export const RecordDeductionBody = z
  .object({
    reason: DeductionReason,
    amount: z.coerce
      .number()
      .positive("Enter an amount above zero")
      .max(100_000_000),
    note: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((v) => v.reason !== "other" || Boolean(v.note), {
    message: "Say what the deduction was for",
    path: ["note"],
  });
export type RecordDeductionBody = z.infer<typeof RecordDeductionBody>;

/**
 * Appealing a deduction.
 *
 * Deductions were write-once: the desk recorded what an insurer cut,
 * the dashboard totalled it, and that was the end of the money. Most
 * hospitals never contest one, which is exactly the habit this is for
 * — docs/adr/0013.
 */
export const DeductionAppealStatus = z.enum([
  "NOT_CONTESTED",
  "CONTESTED",
  "RECOVERED",
  "PARTIALLY_RECOVERED",
  "UPHELD",
]);
export type DeductionAppealStatus = z.infer<typeof DeductionAppealStatus>;

export const DEDUCTION_APPEAL_LABEL: Record<DeductionAppealStatus, string> = {
  NOT_CONTESTED: "Not contested",
  CONTESTED: "Appeal with insurer",
  RECOVERED: "Recovered in full",
  PARTIALLY_RECOVERED: "Partly recovered",
  UPHELD: "Appeal lost",
};

export const ContestDeductionBody = z.object({
  /** How the appeal is being argued. Optional — the act of contesting is the fact being recorded. */
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ContestDeductionBody = z.infer<typeof ContestDeductionBody>;

export const ResolveAppealBody = z.object({
  /**
   * What came back. Zero is a real answer — it means the appeal was
   * fought and lost, which is what stops a desk appealing the same
   * reason to the same insurer forever.
   */
  recoveredAmount: z.coerce.number().min(0).max(100_000_000),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ResolveAppealBody = z.infer<typeof ResolveAppealBody>;

/**
 * The outcome follows from the money, so it is derived rather than
 * asked for: a desk that could pick "recovered in full" while entering
 * a partial amount would eventually do it.
 */
export function appealOutcomeFor(
  deductedAmount: number,
  recoveredAmount: number,
): DeductionAppealStatus {
  if (recoveredAmount <= 0) return "UPHELD";
  if (recoveredAmount >= deductedAmount) return "RECOVERED";
  return "PARTIALLY_RECOVERED";
}

/** Whether this one is still worth the desk's time. */
export function isAppealOpen(status: DeductionAppealStatus): boolean {
  return status === "NOT_CONTESTED" || status === "CONTESTED";
}
