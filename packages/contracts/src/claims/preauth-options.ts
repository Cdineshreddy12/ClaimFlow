import { z } from "zod";

/**
 * The rest of what a hospital can change about its printed form.
 *
 * Kept as one jsonb column rather than a column per switch. These are
 * presentation knobs on one document — nothing queries them, nothing
 * joins on them, and the set will keep growing as hospitals ask for
 * things. A migration per checkbox would be five migrations that teach
 * a reader nothing.
 *
 * `preauthTemplate` stays its own column because it shipped as one and
 * moving it now would be churn for no reader's benefit.
 *
 * Everything here is styling or wording. None of it changes which
 * fields print, in what order, or the rule that an unconfirmed value is
 * a blank line and never a number (docs/adr/0005).
 */

/**
 * The two faces pdf-lib can embed without shipping a font file.
 *
 * Serif is not nostalgia: a TPA desk that has processed typed forms for
 * twenty years reads one as more official, and hospitals ask for it.
 */
export const PreauthTypeface = z.enum(["sans", "serif"]);
export type PreauthTypeface = z.infer<typeof PreauthTypeface>;

export const PREAUTH_TYPEFACE_LABEL: Record<PreauthTypeface, string> = {
  sans: "Helvetica",
  serif: "Times",
};

/**
 * Where the letterhead logo sits.
 *
 * Beside the name suits a square mark; above it suits a wide lockup,
 * which squeezed the address into a ribbon when forced into a column.
 */
export const PreauthLogoPlacement = z.enum(["left", "above"]);
export type PreauthLogoPlacement = z.infer<typeof PreauthLogoPlacement>;

export const PREAUTH_LOGO_PLACEMENT_LABEL: Record<
  PreauthLogoPlacement,
  string
> = {
  left: "Beside the name",
  above: "Above, centred",
};

/** What the form says the hospital is confirming, above the signatures. */
export const DEFAULT_PREAUTH_DECLARATION =
  "We confirm the particulars above are true and that the patient is under treatment at this hospital.";

export const PreauthOptions = z.object({
  typeface: PreauthTypeface.default("sans"),
  logoPlacement: PreauthLogoPlacement.default("left"),
  /**
   * Overrides the declaration sentence. It is a statement the hospital
   * signs, and hospitals word it differently — some name the treating
   * doctor, some cite their registration. Hard-coding one sentence made
   * every hospital sign ours.
   */
  declaration: z.string().trim().max(600).default(""),
  /** "Page 1 of 2" in the footer. Matters because a long form runs to two. */
  pageNumbers: z.boolean().default(false),
  /** Carries the hospital's accent past the title, onto the section names. */
  accentHeadings: z.boolean().default(false),
  /**
   * A second signature line beside the doctor's.
   *
   * Many hospitals need the patient or attendant to sign the same
   * sheet, and a form that has no space for it gets signed in the
   * margin.
   */
  patientSignature: z.boolean().default(false),
});
export type PreauthOptions = z.infer<typeof PreauthOptions>;

export const DEFAULT_PREAUTH_OPTIONS: PreauthOptions = PreauthOptions.parse({});

/** Tolerates null, a partial object, or anything stored before a key existed. */
export function preauthOptions(stored: unknown): PreauthOptions {
  const parsed = PreauthOptions.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_PREAUTH_OPTIONS;
}
