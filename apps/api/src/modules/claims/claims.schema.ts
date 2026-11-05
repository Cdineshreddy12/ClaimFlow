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

/**
 * What the insurer authorised and what was billed. Both optional
 * because they arrive at different times — the sanction with the
 * pre-auth decision, the bill at discharge — and `.refine` stops an
 * empty body quietly doing nothing.
 */
export const UpdateClaimFinancialsBody = z
  .object({
    sanctionedAmount: z.coerce.number().min(0).max(100_000_000).optional(),
    billedAmount: z.coerce.number().min(0).max(100_000_000).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "nothing to update",
  });
export type UpdateClaimFinancialsBody = z.infer<
  typeof UpdateClaimFinancialsBody
>;

export const ListClaimsQuery = z.object({
  status: ClaimStatus.optional(),
  /** desk_executive is forced to "mine" server-side regardless of this value — see claims.service.ts */
  scope: z.enum(["mine", "all"]).default("all"),
});
export type ListClaimsQuery = z.infer<typeof ListClaimsQuery>;

/**
 * One slot on one claim. `required` defaults to false: a slot added
 * because a document fit nowhere is a place to put something, not a
 * demand from the insurer. Restoring a missing checklist is the case
 * that passes true.
 */
export const AddChecklistSlotBody = z.object({
  documentType: z.string().trim().min(1).max(120),
  required: z.boolean().default(false),
});
export type AddChecklistSlotBody = z.infer<typeof AddChecklistSlotBody>;

export const RemoveChecklistSlotQuery = z.object({
  documentType: z.string().trim().min(1).max(120),
});
export type RemoveChecklistSlotQuery = z.infer<typeof RemoveChecklistSlotQuery>;

export const ClaimIdParams = z.object({
  id: z.string().uuid(),
});

/** Shape stored in claims.checklist_snapshot — see docs/adr/0001. */
export const ChecklistSnapshotItem = z.object({
  documentType: z.string(),
  required: z.boolean(),
  /**
   * Set when a human added this slot to this one claim after it was
   * opened, rather than it coming from the rules at creation.
   *
   * Provenance, and the thing that keeps docs/adr/0001 honest: the
   * guarantee is that *rule edits* never reach back into claims in
   * flight, and these fields are how you can still tell, looking at a
   * claim a year later, which of its requirements came from the rules
   * and which a desk added by hand.
   */
  addedAt: z.string().optional(),
  addedBy: z.string().nullable().optional(),
  /** True for a requirement restored from the rules, not a judgement call. */
  fromRules: z.boolean().optional(),
});
export type ChecklistSnapshotItem = z.infer<typeof ChecklistSnapshotItem>;
