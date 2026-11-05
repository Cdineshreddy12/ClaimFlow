import { z } from "zod";
import {
  Gstin,
  HospitalType,
  IndianPhone,
  IndianState,
  NabhStatus,
  OwnershipType,
  Pan,
  Pincode,
  RohiniId,
} from "./identifiers.js";

/**
 * Re-labels an enum's validation message. Zod's default for a blank
 * select is "Invalid enum value. Expected 'day_care' | 'single_specialty'
 * | …", which is internals leaking at a hospital administrator — these
 * messages render directly under the field.
 */
function selectable<T extends [string, ...string[]]>(
  enumSchema: z.ZodEnum<T>,
  message: string,
) {
  return z.enum(enumSchema.options, { errorMap: () => ({ message }) });
}

/**
 * What ClaimFlow needs to know about a hospital to actually run its
 * cashless desk — see docs/adr/0008. Deliberately a fraction of a TPA
 * empanelment form: an insurer collects clinical infrastructure to vet
 * the hospital, we collect only what lands on a pre-auth form or
 * identifies the hospital to a TPA.
 *
 * Split into three steps because that's how the wizard submits it, and
 * each step is independently valid — a hospital can stop after step one
 * and come back.
 */

export const HospitalIdentityStep = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  /** The entity on the PAN, which is often not the trading name the hospital is known by. */
  legalEntityName: z.string().trim().min(1, "Required").max(200),
  hospitalType: selectable(HospitalType, "Select a hospital type"),
  ownershipType: selectable(OwnershipType, "Select an ownership type"),
  bedCount: z.coerce
    .number()
    .int("Whole number of beds")
    .min(1, "Enter the number of beds")
    .max(5000, "That looks too high — check the number"),
});
export type HospitalIdentityStep = z.infer<typeof HospitalIdentityStep>;

export const HospitalComplianceStep = z
  .object({
    /** IRDAI requires this for cashless settlement — a desk can't operate without it, so it isn't optional. */
    rohiniId: RohiniId,
    registrationNumber: z.string().trim().min(1, "Required").max(100),
    registrationValidUntil: z.string().date("Enter a valid date"),
    pan: Pan,
    /** Below the GST threshold some small hospitals genuinely have none. */
    gstin: Gstin.optional().or(z.literal("")),
    nabhStatus: selectable(NabhStatus, "Select an accreditation status"),
    nabhValidUntil: z
      .string()
      .date("Enter a valid date")
      .optional()
      .or(z.literal("")),
  })
  .refine((v) => v.nabhStatus === "none" || Boolean(v.nabhValidUntil), {
    message: "Add the expiry date on the NABH certificate",
    path: ["nabhValidUntil"],
  });
export type HospitalComplianceStep = z.infer<typeof HospitalComplianceStep>;

export const HospitalContactStep = z.object({
  addressLine1: z.string().trim().min(1, "Required").max(200),
  addressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Required").max(100),
  state: selectable(IndianState, "Select a state"),
  pincode: Pincode,
  phone: IndianPhone,
  email: z.string().trim().email("Enter a valid email"),
  website: z
    .string()
    .trim()
    .url("Enter a full URL")
    .optional()
    .or(z.literal("")),
  /** The person a TPA actually calls about a claim — usually the desk head, not the CEO. */
  deskContactName: z.string().trim().min(1, "Required").max(120),
  deskContactPhone: IndianPhone,
  deskContactEmail: z.string().trim().email("Enter a valid email"),
});
export type HospitalContactStep = z.infer<typeof HospitalContactStep>;

/** Everything together — what PUT /organizations/me/profile accepts once the wizard finishes. */
export const HospitalProfile = HospitalIdentityStep.merge(
  HospitalContactStep,
).and(HospitalComplianceStep);
export type HospitalProfile = z.infer<typeof HospitalProfile>;

/**
 * What the printed pre-auth form looks like, as opposed to what it says.
 *
 * Unlike the three steps above, this is never required — it has no entry
 * in hospital.service.ts's REQUIRED_BY_STEP, so a desk can print and fax
 * a form with none of this set, the way it always could. A logo is set
 * separately: `logoFileKey` here is the S3 key the upload endpoint
 * handed back, not a file.
 */
export const HospitalBrandingStep = z.object({
  logoFileKey: z.string().trim().max(1024).optional().or(z.literal("")),
  /** Colors the form's title on the printed PDF. */
  brandAccentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a hex color like #1A73E8")
    .optional()
    .or(z.literal("")),
  tagline: z.string().trim().max(300).optional().or(z.literal("")),
  /** Free text printed under the declaration — bank details, a closing note. */
  documentFooterNote: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type HospitalBrandingStep = z.infer<typeof HospitalBrandingStep>;
