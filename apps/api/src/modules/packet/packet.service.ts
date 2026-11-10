import type { Role } from "@claimflow/contracts";
import {
  getDownloadUrl,
  getObjectBytes,
  putObject,
} from "../../integrations/storage/s3.js";
import * as auditService from "../audit/audit.service.js";
import * as claimsService from "../claims/claims.service.js";
import * as documentsRepository from "../documents/documents.repository.js";
import * as hospitalRepository from "../hospital/hospital.repository.js";
import { buildPacket, type PacketDocument } from "./packet.builder.js";

export class ClaimNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

function formatAddress(org: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string {
  return [org.addressLine1, org.addressLine2, org.city, org.state, org.pincode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Builds the merged packet and stores it alongside the claim's other
 * objects, then hands back a pre-signed URL (docs/adr/0005).
 */
export async function generatePacket(auth: AuthContext, claimId: string) {
  // Goes through claims.service so desk_executive scoping applies —
  // an exec can't generate a packet for someone else's claim.
  const claim = await claimsService.getClaim(auth, claimId);

  const hospital = await hospitalRepository.get();
  if (!hospital) throw new ClaimNotFoundError(claimId);

  const allDocuments = await documentsRepository.listForClaim(claimId);
  if (allDocuments === undefined) throw new ClaimNotFoundError(claimId);

  const confirmed = allDocuments.filter(
    (doc) => doc.confirmedAt !== null && doc.checklistSlot !== null,
  );

  // Order by the claim's own checklist snapshot so the packet reads in
  // the order the insurer's checklist asks for, not upload order.
  const slotOrder = new Map(
    claim.checklistSnapshot.map((item, i) => [item.documentType, i]),
  );
  confirmed.sort(
    (a, b) =>
      (slotOrder.get(a.checklistSlot!) ?? Number.MAX_SAFE_INTEGER) -
      (slotOrder.get(b.checklistSlot!) ?? Number.MAX_SAFE_INTEGER),
  );

  const sources: PacketDocument[] = await Promise.all(
    confirmed.map(async (doc) => ({
      slot: doc.checklistSlot!,
      fileName: doc.fileUrl.split("/").pop() ?? doc.fileUrl,
      bytes: await getObjectBytes(doc.fileUrl),
    })),
  );

  const { bytes, skipped } = await buildPacket(
    {
      hospitalName: hospital.name,
      hospitalAddress: formatAddress(hospital),
      rohiniId: hospital.rohiniId,
      insurerName: claim.insurerName,
      patientName: claim.patientName,
      procedureName: claim.procedureName,
      claimId: claim.id,
      billedAmount: claim.billedAmount,
      generatedAt: new Date(),
    },
    sources,
  );

  // Timestamped key rather than a fixed one: a desk may regenerate after
  // adding a document, and overwriting would destroy the packet that was
  // actually sent to the TPA earlier.
  const key = `claims/${claimId}/packets/${Date.now()}-claim-packet.pdf`;
  await putObject(key, bytes, "application/pdf");

  await auditService.record(auth, {
    action: "packet.generated",
    entityType: "claim",
    entityId: claimId,
    after: { key, documentCount: sources.length, skipped: skipped.length },
  });

  return {
    downloadUrl: await getDownloadUrl(key),
    documentCount: sources.length,
    skipped,
  };
}
