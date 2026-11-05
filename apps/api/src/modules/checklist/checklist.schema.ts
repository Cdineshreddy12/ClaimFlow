import { z } from "zod";

export const CreateChecklistRuleBody = z.object({
  insurerId: z.string().uuid(),
  procedureId: z.string().uuid(),
  documentType: z.string().min(1),
  required: z.boolean().default(true),
});
export type CreateChecklistRuleBody = z.infer<typeof CreateChecklistRuleBody>;

export const UpdateChecklistRuleBody = z
  .object({
    documentType: z.string().min(1).optional(),
    required: z.boolean().optional(),
  })
  .refine(
    (body) => body.documentType !== undefined || body.required !== undefined,
    {
      message: "nothing to update",
    },
  );
export type UpdateChecklistRuleBody = z.infer<typeof UpdateChecklistRuleBody>;

export const ListChecklistRulesQuery = z.object({
  insurerId: z.string().uuid(),
  procedureId: z.string().uuid(),
});
export type ListChecklistRulesQuery = z.infer<typeof ListChecklistRulesQuery>;

export const ChecklistRuleIdParams = z.object({
  id: z.string().uuid(),
});

/**
 * Accepting one proposal. The action comes from the client because the
 * proposal it came from already said which it was; the service
 * re-checks that the rule it implies actually exists.
 */
export const ApplyProposalBody = z.object({
  insurerId: z.string().uuid(),
  procedureId: z.string().uuid(),
  documentType: z.string().trim().min(1),
  action: z.enum(["add_required", "make_required"]),
});
export type ApplyProposalBody = z.infer<typeof ApplyProposalBody>;
