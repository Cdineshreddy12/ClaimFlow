import { z } from "zod";

/**
 * The TPA/insurer master list.
 *
 * Shared reference data rather than per-claim text: the same Company B
 * is the same organisation on every claim, and checklist rules key off
 * it (docs/adr/0001). Letting a desk type the name per claim would
 * fragment the rules silently.
 */
export const InsurerType = z.enum(["insurer", "tpa"]);
export type InsurerType = z.infer<typeof InsurerType>;

export const INSURER_TYPE_LABEL: Record<InsurerType, string> = {
  insurer: "Insurer",
  tpa: "TPA",
};

export const InsurerInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  type: z.enum(InsurerType.options, {
    errorMap: () => ({ message: "Pick insurer or TPA" }),
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
