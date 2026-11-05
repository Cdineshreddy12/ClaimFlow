import { z } from "zod";

/**
 * What the insurer actually paid, and when.
 *
 * Distinct from `sanctionedAmount`, which is what they authorised. The
 * two routinely differ — that difference is a deduction, and the whole
 * premise of the product is that most of it is avoidable paperwork. A
 * figure inferred as "sanctioned minus deductions" would make the
 * deductions dashboard circular; this is the receipt.
 */
export const RecordPaymentBody = z
  .object({
    settledAmount: z.coerce
      .number()
      .min(0, "Enter the amount received")
      .max(100_000_000),
    /** Date the money arrived, not the date it was recorded here. */
    settledOn: z.string().date("Enter a valid date"),
  })
  .refine(
    (v) => new Date(`${v.settledOn}T00:00:00`) <= new Date(),
    // A payment dated next week is a typo, and it would skew every
    // "settled this month" figure on the dashboard.
    { message: "That date is in the future", path: ["settledOn"] },
  );
export type RecordPaymentBody = z.infer<typeof RecordPaymentBody>;

/**
 * The shortfall against what was authorised. Null when either number is
 * missing — showing a shortfall equal to the whole sanctioned amount
 * just because payment hasn't been recorded yet would be alarming and
 * wrong.
 */
export function shortfall(
  sanctionedAmount: string | null,
  settledAmount: string | null,
): number | null {
  if (sanctionedAmount === null || settledAmount === null) return null;
  return Number(sanctionedAmount) - Number(settledAmount);
}
