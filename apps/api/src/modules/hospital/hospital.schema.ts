import { z } from "zod";
import {
  HospitalBrandingStep,
  HospitalComplianceStep,
  HospitalContactStep,
  HospitalIdentityStep,
} from "@claimflow/contracts";

/**
 * The wizard saves after each step rather than holding 20+ fields in
 * browser memory until the end — a half-finished profile survives a
 * refresh. Each step is validated by its own contract schema, so a
 * partial save is still a *valid* partial save.
 *
 * "branding" isn't a wizard step — it's never required and has no entry
 * in REQUIRED_BY_STEP — but it saves through the same endpoint because
 * it's the same patch-one-slice-of-the-row shape as the other three.
 */
export const UpdateProfileBody = z.union([
  z.object({ step: z.literal("identity"), data: HospitalIdentityStep }),
  z.object({ step: z.literal("compliance"), data: HospitalComplianceStep }),
  z.object({ step: z.literal("contact"), data: HospitalContactStep }),
  z.object({ step: z.literal("branding"), data: HospitalBrandingStep }),
]);
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;

/** Logos only — pdf-lib can only embed what it can decode, and that's PNG and JPEG. */
export const RequestLogoUploadUrlBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(["image/png", "image/jpeg"]),
});
export type RequestLogoUploadUrlBody = z.infer<typeof RequestLogoUploadUrlBody>;
