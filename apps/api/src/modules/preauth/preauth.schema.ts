import { z } from "zod";

export const ClaimIdParams = z.object({ claimId: z.string().uuid() });
export type ClaimIdParams = z.infer<typeof ClaimIdParams>;

export const FieldKeyParams = z.object({
  claimId: z.string().uuid(),
  fieldKey: z.string().min(1).max(100),
});
export type FieldKeyParams = z.infer<typeof FieldKeyParams>;
