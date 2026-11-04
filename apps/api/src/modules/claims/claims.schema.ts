import { z } from "zod";
import { ClaimStatus } from "@claimflow/contracts";

export const CreateClaimBody = z.object({
  patientName: z.string().min(1),
  insurerId: z.string().uuid(),
  procedureId: z.string().uuid(),
  billedAmount: z.coerce.number().positive().optional(),
  admittedAt: z.coerce.date().optional(),
});
export type CreateClaimBody = z.infer<typeof CreateClaimBody>;

export const UpdateClaimStatusBody = z.object({
  status: ClaimStatus,
  slaDeadline: z.coerce.date().optional(),
});
export type UpdateClaimStatusBody = z.infer<typeof UpdateClaimStatusBody>;

export const ListClaimsQuery = z.object({
  status: ClaimStatus.optional(),
  /** desk_executive is forced to "mine" server-side regardless of this value — see claims.service.ts */
  scope: z.enum(["mine", "all"]).default("all"),
});
export type ListClaimsQuery = z.infer<typeof ListClaimsQuery>;

export const ClaimIdParams = z.object({
  id: z.string().uuid(),
});
