import type { Role } from "@claimflow/contracts";
import { getDownloadUrl } from "../../integrations/storage/s3.js";
import * as auditService from "../audit/audit.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import { getMemberId } from "../members/members.repository.js";
import * as repo from "./doctor-approval.repository.js";

export class ClaimNotFoundError extends Error {}
export class LinkNotFoundError extends Error {}
export class LinkExpiredError extends Error {}
export class LinkAlreadyDecidedError extends Error {}
export class NothingToApproveError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

/** Slots whose contents a doctor is being asked to vouch for — clinical, not administrative. */
const CLINICAL_SLOT_PATTERN = /note|report|summary|record|investigation/i;

export async function requestApproval(
  auth: AuthContext,
  claimId: string,
  doctorName: string,
) {
  const memberId = await getMemberId(auth.userId);
  const approval = await repo.create(claimId, doctorName, memberId);
  if (!approval) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "doctor_approval.requested",
    entityType: "claim",
    entityId: claimId,
    after: { doctorName, expiresAt: approval.expiresAt },
    actorId: memberId,
  });

  return approval;
}

export async function listForClaim(auth: AuthContext, claimId: string) {
  const result = await repo.listForClaim(claimId);
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

function assertUsable(
  row: NonNullable<Awaited<ReturnType<typeof repo.getByTokenWithContext>>>,
) {
  const { approval } = row;
  if (approval.approvedAt || approval.declinedAt) {
    throw new LinkAlreadyDecidedError(approval.id);
  }
  if (approval.expiresAt < new Date()) throw new LinkExpiredError(approval.id);
}

/** The confirmed clinical documents on a claim — what a doctor is being asked to vouch for. */
async function clinicalDocuments(claimId: string) {
  const documents = (await documentsRepository.listForClaim(claimId)) ?? [];
  return documents.filter(
    (doc) =>
      doc.confirmedAt !== null &&
      doc.checklistSlot !== null &&
      CLINICAL_SLOT_PATTERN.test(doc.checklistSlot),
  );
}

/**
 * What the doctor sees on their phone. Unauthenticated — the token is
 * the credential — so this is the narrowest useful view: who the patient
 * is, what procedure, and read links for the clinical documents only.
 * Opening it is audited, because an unauthenticated read of patient data
 * is exactly the thing a DPDP trail needs to show.
 */
export async function viewByToken(token: string) {
  const row = await repo.getByTokenWithContext(token);
  if (!row) throw new LinkNotFoundError(token);
  assertUsable(row);

  if (!row.approval.firstViewedAt) {
    await repo.markFirstViewed(row.approval.id);
    await auditService.record(
      { userId: "" },
      {
        action: "doctor_approval.viewed",
        entityType: "claim",
        entityId: row.claimId,
        after: { doctorName: row.approval.doctorName },
        // No `members` row exists for a link-holder — the actor is the
        // token, and null says that honestly rather than inventing one.
        actorId: null,
      },
    );
  }

  const clinical = await clinicalDocuments(row.claimId);

  return {
    hospitalName: row.hospitalName,
    patientName: row.patientName,
    procedureName: row.procedureName,
    insurerName: row.insurerName,
    doctorName: row.approval.doctorName,
    expiresAt: row.approval.expiresAt,
    documents: await Promise.all(
      clinical.map(async (doc) => ({
        slot: doc.checklistSlot!,
        downloadUrl: await getDownloadUrl(doc.fileUrl),
      })),
    ),
  };
}

export async function decide(
  token: string,
  decision: { approved: true } | { approved: false; reason: string },
) {
  const row = await repo.getByTokenWithContext(token);
  if (!row) throw new LinkNotFoundError(token);
  assertUsable(row);

  // An approval over an empty set is a clinical attestation to nothing,
  // filed under a named doctor. The page hides the button, but the
  // token is a public credential and the page is not the boundary.
  // Declining is always allowed: "attach the notes" is the useful
  // answer when there is nothing there.
  if (
    decision.approved &&
    (await clinicalDocuments(row.claimId)).length === 0
  ) {
    throw new NothingToApproveError(row.claimId);
  }

  const updated = await repo.recordDecision(row.approval.id, decision);

  await auditService.record(
    { userId: "" },
    {
      action: decision.approved
        ? "doctor_approval.approved"
        : "doctor_approval.declined",
      entityType: "claim",
      entityId: row.claimId,
      after: {
        doctorName: row.approval.doctorName,
        ...(decision.approved ? {} : { reason: decision.reason }),
      },
      actorId: null,
    },
  );

  return updated;
}
