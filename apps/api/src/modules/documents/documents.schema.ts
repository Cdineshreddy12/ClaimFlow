import { z } from "zod";
import {
  UPLOAD_MAX_BYTES,
  formatUploadLimit,
  isAllowedUploadType,
} from "@claimflow/contracts";

export const ClaimIdParams = z.object({
  claimId: z.string().uuid(),
});

export const DocumentIdParams = z.object({
  claimId: z.string().uuid(),
  documentId: z.string().uuid(),
});

/**
 * `sizeBytes` is not decoration. It is signed into the URL as the
 * exact Content-Length S3 will accept, so a client that asks for a
 * 2MB upload cannot then PUT 2GB through the same link — which is
 * what it could do when the only limit was a non-empty content type.
 */
export const RequestUploadUrlBody = z.object({
  fileName: z.string().min(1),
  contentType: z
    .string()
    .min(1)
    .refine(isAllowedUploadType, "attach a PDF or a scan"),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive("that file is empty")
    .max(UPLOAD_MAX_BYTES, `files are limited to ${formatUploadLimit()}`),
});
export type RequestUploadUrlBody = z.infer<typeof RequestUploadUrlBody>;

export const RegisterDocumentBody = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1),
  /** Same value the client used on the pre-signed PUT — the classifier needs it to know how to read the file. */
  contentType: z
    .string()
    .min(1)
    .refine(isAllowedUploadType, "attach a PDF or a scan"),
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
