import { z } from "zod";
import {
  HospitalComplianceStep,
  HospitalContactStep,
  HospitalIdentityStep,
} from "@claimflow/contracts";

/**
 * The wizard saves after each step rather than holding 20+ fields in
 * browser memory until the end — a half-finished profile survives a
 * refresh. Each step is validated by its own contract schema, so a
 * partial save is still a *valid* partial save.
 */
export const UpdateProfileBody = z.union([
  z.object({ step: z.literal("identity"), data: HospitalIdentityStep }),
  z.object({ step: z.literal("compliance"), data: HospitalComplianceStep }),
  z.object({ step: z.literal("contact"), data: HospitalContactStep }),
]);
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;
