import { z } from "zod";

/**
 * The TPA/insurer master list.
 *
 * Shared reference data rather than per-claim text: the same Company B
 * is the same organisation on every claim, and checklist rules key off
 * it (docs/adr/0001). Letting a desk type the name per claim would
 * fragment the rules silently.
 */
/**
 * Who pays, and under what rules.
 *
 * A government scheme is a payer on this list rather than a table of
 * its own. Everything the desk configures is already keyed on this
 * row — checklist rules per payer and procedure (docs/adr/0001),
 * per-payer pre-auth layouts, receivables, turnaround — so a scheme
 * that lives here inherits all of it, and a scheme that lived
 * elsewhere would need every one of them written twice.
 *
 * What a scheme does NOT share is the money model: its rate comes from
 * a package, fixed, rather than from an estimate the desk negotiates.
 * That difference lives on the claim, not here.
 */
export const InsurerType = z.enum(["insurer", "tpa", "scheme"]);
export type InsurerType = z.infer<typeof InsurerType>;

export const INSURER_TYPE_LABEL: Record<InsurerType, string> = {
  insurer: "Insurer",
  tpa: "TPA",
  scheme: "Government scheme",
};

/**
 * PM-JAY and the state schemes pay a package rate, not an estimate.
 *
 * The one question the rest of the product asks about a payer: an
 * itemised estimate is negotiable and a package rate is not, and that
 * changes what "sanctioned" means on the claim.
 */
export function isSchemePayer(type: string | null | undefined): boolean {
  return type === "scheme";
}

export const InsurerInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  type: z.enum(InsurerType.options, {
    errorMap: () => ({ message: "Pick insurer, TPA or government scheme" }),
  }),
  /** The desk's own shorthand, as it appears on their correspondence. */
  code: z.string().trim().max(30).optional().or(z.literal("")),
  contactEmail: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("")),
});
export type InsurerInput = z.infer<typeof InsurerInput>;

/**
 * Retiring rather than deleting.
 *
 * An insurer with claims against it can never be removed — the claims
 * would lose the name they were filed under. Deactivating keeps every
 * historical claim readable while taking it off the list for new ones.
 */
export const SetInsurerActiveBody = z.object({ isActive: z.boolean() });
export type SetInsurerActiveBody = z.infer<typeof SetInsurerActiveBody>;
