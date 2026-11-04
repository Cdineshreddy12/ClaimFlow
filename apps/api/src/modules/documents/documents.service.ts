import {
  buildObjectKey,
  deleteObject,
  getDownloadUrl,
  getObjectBytes,
  getUploadUrl,
} from "../../integrations/storage/s3.js";
import { getClassifier } from "../../integrations/classifier/index.js";
import { canOcr, detectText } from "../../integrations/ocr/textract.js";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import { getOrgMemberId } from "../org-members/org-members.repository.js";
import * as documentsRepository from "./documents.repository.js";
import type { RequestUploadUrlBody } from "./documents.schema.js";

export class ClaimNotFoundError extends Error {}
export class DocumentNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  organizationId: string;
}

export async function listDocuments(auth: AuthContext, claimId: string) {
  const result = await documentsRepository.listForClaim(
    auth.organizationId,
    claimId,
  );
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

/**
 * Step 1 of the upload flow (see docs/adr/0003): the API hands back a
 * pre-signed PUT URL and never streams the file through itself. The
 * frontend uploads directly to S3, then calls registerDocument once that
 * succeeds.
 */
export async function requestUploadUrl(
  auth: AuthContext,
  claimId: string,
  body: RequestUploadUrlBody,
) {
  const key = buildObjectKey(auth.organizationId, claimId, body.fileName);
  const uploadUrl = await getUploadUrl(key, body.contentType);
  return { uploadUrl, key };
}

export async function registerDocument(
  auth: AuthContext,
  claimId: string,
  key: string,
  contentType: string,
) {
  const created = await documentsRepository.create(
    auth.organizationId,
    claimId,
    { fileUrl: key },
  );
  if (!created) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "document.registered",
    entityType: "document",
    entityId: created.id,
    after: { claimId },
  });

  // Inline rather than queued: a desk exec is watching this upload and
  // wants the suggestion now, and one classification is a single call,
  // not the multi-step OCR pipeline docs/adr/0003 reserved a queue for.
  // Revisit when OCR lands in front of it.
  return (
    (await classifyDocument(auth, claimId, created.id, key, contentType)) ??
    created
  );
}

/**
 * Attaches a slot suggestion to an already-registered document.
 *
 * Never throws. The file is uploaded and the row exists; failing the
 * request now would tell the desk their upload broke when it didn't,
 * and they can always pick a slot by hand. A failure leaves the
 * suggestion columns null, which the UI reads as "unclassified".
 */
export async function classifyDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
  key: string,
  contentType: string,
) {
  const claim = await claimsRepository.getClaimById(
    auth.organizationId,
    claimId,
  );
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
 * OCR, when the file is an image Textract can read.
 *
 * Runs in front of the classifier rather than instead of it — the model
 * already reads printed scans well, and this is for the brief's hard
 * case, handwritten doctors' notes, where character extraction is the
 * part a vision model is weakest at.
 *
 * Never throws: OCR is an enhancement to a suggestion that is itself
 * optional, so a Textract outage must not stop a document being
 * classified, let alone uploaded.
 */
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
  const document = await documentsRepository.getById(
    auth.organizationId,
    claimId,
    documentId,
  );
  if (!document) throw new DocumentNotFoundError(documentId);
  return getDownloadUrl(document.fileUrl);
}

/**
 * The human-confirm step the product brief requires for every AI (or, for
 * now, manually-sorted) classification — see docs/adr/0005. No document
 * counts toward a claim's checklist until this has been clicked.
 */
export async function confirmDocument(
  auth: AuthContext,
  claimId: string,
  documentId: string,
  checklistSlot: string,
) {
  const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
  const updated = await documentsRepository.confirm(
    auth.organizationId,
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
  const document = await documentsRepository.getById(
    auth.organizationId,
    claimId,
    documentId,
  );
  if (!document) throw new DocumentNotFoundError(documentId);
  await documentsRepository.remove(auth.organizationId, claimId, documentId);
  await deleteObject(document.fileUrl);

  await auditService.record(auth, {
    action: "document.discarded",
    entityType: "document",
    entityId: documentId,
    before: { claimId, checklistSlot: document.checklistSlot },
  });
}
