import {
  buildObjectKey,
  deleteObject,
  getDownloadUrl,
  getUploadUrl,
} from "../../integrations/storage/s3.js";
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
) {
  const created = await documentsRepository.create(
    auth.organizationId,
    claimId,
    { fileUrl: key },
  );
  if (!created) throw new ClaimNotFoundError(claimId);
  return created;
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
}
