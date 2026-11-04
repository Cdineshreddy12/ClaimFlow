import { z } from "zod";

export const ClaimIdParams = z.object({
  claimId: z.string().uuid(),
});

export const QueryIdParams = z.object({
  id: z.string().uuid(),
});

/**
 * No AI summarizer is wired up yet (see docs/adr/0003 — same boundary as
 * the documents module). A desk exec pastes the TPA's email and fills in
 * the summary/requested items by hand for now. When AI lands, aiSummary
 * becomes a pre-filled suggestion instead of a blank field — the original
 * email stays mandatory either way, per docs/adr/0005.
 */
export const CreateQueryBody = z.object({
  tpaRawEmail: z.string().min(1),
  aiSummary: z.string().optional(),
  requestedItems: z.array(z.string().min(1)).default([]),
  deadline: z.coerce.date().optional(),
});
export type CreateQueryBody = z.infer<typeof CreateQueryBody>;

export const UpdateQueryBody = z
  .object({
    aiSummary: z.string().optional(),
    requestedItems: z.array(z.string().min(1)).optional(),
    deadline: z.coerce.date().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "nothing to update",
  });
export type UpdateQueryBody = z.infer<typeof UpdateQueryBody>;

export const ListInboxQuery = z.object({
  status: z.enum(["open", "replied", "all"]).default("open"),
});
export type ListInboxQuery = z.infer<typeof ListInboxQuery>;
