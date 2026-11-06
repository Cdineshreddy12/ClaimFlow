import { z } from "zod";

/**
 * What a claim against a government scheme is worth.
 *
 * PM-JAY and the state schemes do not take an estimate. The desk picks
 * a package from the scheme's rate master — HBP-SG-012, say — and the
 * rate attached to that code is what will be paid. There is nothing to
 * itemise and nothing to negotiate.
 *
 * That inverts the private model this product was built around. On a
 * private claim the hospital states a cost and the insurer sanctions an
 * amount against it, and the gap between the two is the whole subject
 * of docs/adr/0012. On a scheme claim the sanctioned amount is known
 * before anyone asks for it, because the package says so.
 *
 * So the rate IS the sanctioned amount, written at creation rather than
 * waiting on an answer that is never coming. A desk that sees
 * "Sanctioned: —" on a scheme claim would go looking for a decision the
 * scheme has no reason to send.
 */

/**
 * Package codes vary by scheme — HBP-SG-012 on PM-JAY, different
 * shapes on the state schemes — so this validates the form rather than
 * a catalogue. A rate master that could reject an unknown code is a
 * bigger piece of work (see the options discussed with the desk); until
 * one exists, a typo here is a typo on the claim.
 */
export const PackageCode = z
  .string()
  .trim()
  .min(2, "Enter the package code")
  .max(40)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9/\- .]*$/,
    "Letters, digits, hyphens and slashes",
  );

export const SchemePackage = z.object({
  packageCode: PackageCode,
  /** Fixed by the scheme. Not an estimate, and not negotiable. */
  packageRate: z.coerce
    .number()
    .positive("Enter the package rate")
    .max(100_000_000),
});
export type SchemePackage = z.infer<typeof SchemePackage>;

/**
 * Both fields or neither.
 *
 * A code with no rate leaves the claim worth nothing on every money
 * view; a rate with no code is an amount nobody can trace back to the
 * scheme's master. Half of this is worse than none of it.
 */
export const SchemePackageInput = SchemePackage.partial().refine(
  (value) =>
    (value.packageCode === undefined || value.packageCode === "") ===
    (value.packageRate === undefined),
  { message: "Give both the package code and its rate, or neither" },
);
export type SchemePackageInput = z.infer<typeof SchemePackageInput>;
