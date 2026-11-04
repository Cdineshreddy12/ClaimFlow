import { z } from "zod";

export const ClaimIdParams = z.object({
  claimId: z.string().uuid(),
});

export const DocumentIdParams = z.object({
  claimId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export const RequestUploadUrlBody = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});
export type RequestUploadUrlBody = z.infer<typeof RequestUploadUrlBody>;

export const RegisterDocumentBody = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1),
  /** Same value the client used on the pre-signed PUT — the classifier needs it to know how to read the file. */
  contentType: z.string().min(1).default("application/octet-stream"),
});
export type RegisterDocumentBody = z.infer<typeof RegisterDocumentBody>;

/**
 * No AI classifier is wired up yet (see docs/adr/0003) — a human picks
 * the slot directly. When classification lands, this becomes "confirm
 * the AI's suggestion" instead of "pick from scratch," but the shape of
 * confirming into a slot stays the same.
 */
export const ConfirmDocumentBody = z.object({
  checklistSlot: z.string().min(1),
});
export type ConfirmDocumentBody = z.infer<typeof ConfirmDocumentBody>;
