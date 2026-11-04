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
