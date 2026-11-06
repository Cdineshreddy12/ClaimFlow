import { z } from "zod";

/**
 * The procedures this hospital files claims for.
 *
 * The other half of the key a checklist hangs on — rules are per
 * insurer AND per procedure (docs/adr/0001) — and until now it was the
 * half nobody could edit. Insurers got a master a desk maintains;
 * procedures were whatever the seed file happened to contain, so a
 * hospital could not open a claim for anything it had not been shipped
 * with.
 *
 * Deliberately not an ICD or CPT catalogue. A desk picks the procedure
 * by the name the surgeon uses on the note, and tying the list to a
 * coding standard would make "Gall bladder removal" unsayable.
 */
export const ProcedureInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(160),
  /** The hospital's own shorthand, as it appears on their tariff. */
  code: z.string().trim().max(30).optional().or(z.literal("")),
});
export type ProcedureInput = z.infer<typeof ProcedureInput>;
