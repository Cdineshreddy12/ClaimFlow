import {
  buildObjectKey,
  deleteObject,
  getDownloadUrl,
  getObjectBytes,
  getUploadUrl,
} from "../../integrations/storage/s3.js";
import type { DocumentClassification } from "@claimflow/contracts";
import { getClassifier } from "../../integrations/classifier/index.js";
import { canOcr, detectText } from "../../integrations/ocr/textract.js";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import { getMemberId } from "../members/members.repository.js";
import * as documentsRepository from "./documents.repository.js";
import type { RequestUploadUrlBody } from "./documents.schema.js";

export class ClaimNotFoundError extends Error {}
export class DocumentNotFoundError extends Error {}
/** Re-reading a filed document would overwrite the evidence someone acted on. */
export class DocumentAlreadyFiledError extends Error {}
/** The classifier couldn't read the file — a corrupt scan, or a format it refuses. */
export class DocumentUnreadableError extends Error {}

interface AuthContext {
  userId: string;
}

export async function listDocuments(auth: AuthContext, claimId: string) {
  const result = await documentsRepository.listForClaim(claimId);
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

/**
 * Step 1 of the upload flow (see docs/adr/0003): the API hands back a
 * pre-signed PUT URL and never streams the file through itself.
 */
export async function requestUploadUrl(
  auth: AuthContext,
  claimId: string,
  body: RequestUploadUrlBody,
) {
  const key = buildObjectKey(claimId, body.fileName);
  const uploadUrl = await getUploadUrl(key, body.contentType, body.sizeBytes);
  return { uploadUrl, key };
}

export async function registerDocument(
  auth: AuthContext,
  claimId: string,
  key: string,
  contentType: string,
  /** A classification that has already been paid for. */
  presetClassification?: DocumentClassification,
) {
  const created = await documentsRepository.create(claimId, { fileUrl: key });
  if (!created) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "document.registered",
    entityType: "document",
    entityId: created.id,
    after: { claimId },
  });

  if (presetClassification) {
    return (
      (await documentsRepository.saveClassification(
        created.id,
        presetClassification,
      )) ?? created
    );
  }

  // Inline rather than queued: a desk exec is watching this upload and
  // wants the suggestion now, and one classification is a single call, not
  // the multi-step OCR pipeline docs/adr/0003 reserved a queue for.
  return (
    (await classifyDocument(auth, claimId, created.id, key, contentType)) ??
    created
  );
}

/** Attaches a slot suggestion to an already-registered document. */
export async function classifyDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
  key: string,
  contentType: string,
) {
  const claim = await claimsRepository.getClaimById(claimId);
  const candidateSlots = (claim?.checklistSnapshot ?? []).map(
    (item) => item.documentType,
  );
  if (candidateSlots.length === 0) return undefined;

  try {
    // Read the bytes once and share them: OCR and the classifier both
    // want the same object, and S3 shouldn't be paid for twice.
    let cached: Uint8Array | undefined;
    const readBytes = async () => (cached ??= await getObjectBytes(key));

    const classification = await getClassifier().classify({
      fileName: displayFileName(key),
      contentType,
      candidateSlots,
      readBytes,
      ocrText: await extractText(contentType, readBytes),
    });
    return documentsRepository.saveClassification(documentId, classification);
  } catch (err) {
    console.error("document classification failed", {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Reads an already-uploaded document again, against the checklist as it
 * stands now.
 */
export async function reclassifyDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
) {
  const document = await documentsRepository.getById(claimId, documentId);
  if (!document) throw new DocumentNotFoundError(documentId);
  if (document.confirmedAt) throw new DocumentAlreadyFiledError(documentId);

  const updated = await classifyDocument(
    auth,
    claimId,
    documentId,
    document.fileUrl,
    contentTypeFromKey(document.fileUrl),
  );

  // classifyDocument swallows its own failures, which is right on the
  // upload path — the file is stored and the desk can pick a slot by hand,
  // so failing the upload would report a break that didn't happen.
  if (!updated) throw new DocumentUnreadableError(documentId);
  return updated;
}

/** The upload recorded no content type, so the extension is what's left. */
function contentTypeFromKey(key: string): string {
  const ext = key.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/** OCR, when the file is an image Textract can read. */
async function extractText(
  contentType: string,
  readBytes: () => Promise<Uint8Array>,
): Promise<string | undefined> {
  if (!canOcr(contentType)) return undefined;
  try {
    const result = await detectText(await readBytes());
    return result?.text;
  } catch (err) {
    console.error("OCR failed, classifying without it", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Strips the uuid prefix buildObjectKey adds, back to what the user uploaded. */
function displayFileName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    "",
  );
}

export async function getDocumentDownloadUrl(
  auth: AuthContext,
  claimId: string,
  documentId: string,
) {
  const document = await documentsRepository.getById(claimId, documentId);
  if (!document) throw new DocumentNotFoundError(documentId);
  return getDownloadUrl(document.fileUrl);
}

/**
 * The human-confirm step the product brief requires for every AI (or, for
 * now, manually-sorted) classification — see docs/adr/0005.
 */
export async function confirmDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
  checklistSlot: string,
) {
  const memberId = await getMemberId(auth.userId);
  const updated = await documentsRepository.confirm(
    claimId,
    documentId,
    checklistSlot,
    memberId,
  );
  if (!updated) throw new DocumentNotFoundError(documentId);

  await auditService.record(auth, {
    action: "document.confirmed",
    entityType: "document",
    entityId: documentId,
    after: { claimId, checklistSlot },
    actorId: memberId,
  });

  return updated;
}

export async function discardDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
) {
  const document = await documentsRepository.getById(claimId, documentId);
  if (!document) throw new DocumentNotFoundError(documentId);
  await documentsRepository.remove(claimId, documentId);
  await deleteObject(document.fileUrl);

  await auditService.record(auth, {
    action: "document.discarded",
    entityType: "document",
    entityId: documentId,
    before: { claimId, checklistSlot: document.checklistSlot },
  });
}
