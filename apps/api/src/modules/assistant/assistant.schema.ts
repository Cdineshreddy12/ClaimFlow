import { z } from "zod";
import { PROPOSAL_KINDS } from "./assistant.tools.js";

export const AttachmentIdParams = z.object({ id: z.string().uuid() });

export const RequestAttachmentUploadBody = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
});
export type RequestAttachmentUploadBody = z.infer<
  typeof RequestAttachmentUploadBody
>;

export const RegisterAttachmentBody = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
});
export type RegisterAttachmentBody = z.infer<typeof RegisterAttachmentBody>;

export const ConversationIdParams = z.object({ id: z.string().uuid() });

/**
 * The conversation is held server-side and referenced by id.
 *
 * It used to travel with every turn — the browser kept the provider's
 * message blocks and posted them back. That was simple and it was why
 * nothing survived a closed tab. Now the server holds it, which also
 * means a turn carries one id instead of the whole history.
 *
 * Omit `conversationId` and a new conversation is started.
 */
export const ChatBody = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().max(8_000).default(""),
    attachmentIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .refine(
    (body) => body.message.trim().length > 0 || body.attachmentIds.length > 0,
    { message: "nothing to send" },
  );
export type ChatBody = z.infer<typeof ChatBody>;

/**
 * An approval carries the proposal's payload back.
 *
 * Deliberately not "approve proposal id X" against something the server
 * stashed: the desk can edit a proposal before approving it — a wrong
 * slot, the wrong claim — and the thing that executes has to be what
 * they actually saw and changed, not what the model first said. It is
 * re-parsed against the same schema either way.
 */
export const ApproveProposalBody = z.object({
  kind: z.enum(PROPOSAL_KINDS),
  input: z.record(z.unknown()),
  /**
   * Where the card came from, so the approval can be recorded against
   * it and the same card can't be offered again next week.
   *
   * Optional because the approval is valid without them — what
   * executes is the payload, and bookkeeping that failed would be a
   * poor reason to refuse a filing that is otherwise fine.
   */
  conversationId: z.string().uuid().optional(),
  proposalId: z.string().min(1).max(128).optional(),
});
export type ApproveProposalBody = z.infer<typeof ApproveProposalBody>;
