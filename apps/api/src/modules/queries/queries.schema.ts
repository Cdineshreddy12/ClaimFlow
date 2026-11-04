import { z } from "zod";

export const ClaimIdParams = z.object({
  claimId: z.string().uuid(),
});

export const QueryIdParams = z.object({
  id: z.string().uuid(),
});

/**
 * A desk exec pastes the TPA's email; the summariser fills `aiSummary`,
 * `requestedItems` and `deadline` when they're left blank, and leaves
 * anything they typed themselves alone (docs/adr/0003). Every one of
 * those is optional here because the desk can always type its own, and
 * because a summariser failure must not cost them the paste. The raw
 * email stays mandatory either way — it's the record, per docs/adr/0005.
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

/**
 * What actually gets inserted: the client's body plus anything the
 * summariser derived. Kept separate from CreateQueryBody so the derived
 * provenance fields can't be set by a client, and so the compiler
 * catches them being dropped on the way to the insert.
 */
export interface CreateQueryInput extends CreateQueryBody {
  summarisedBy?: string | undefined;
  deadlineInferred?: boolean | undefined;
}
