import {
  canTransition,
  slaDeadlineFor,
  type DecideEnhancementBody,
  type RequestEnhancementBody,
  type Role,
} from "@claimflow/contracts";
import * as auditService from "../audit/audit.service.js";
import * as claimsRepository from "../claims/claims.repository.js";
import { getMemberId } from "../members/members.repository.js";
import * as repo from "./enhancements.repository.js";

export class ClaimNotFoundError extends Error {}
export class EnhancementNotFoundError extends Error {}
/** One claim, one open enhancement — see requestEnhancement. */
export class EnhancementAlreadyOpenError extends Error {}
export class EnhancementAlreadyDecidedError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

export async function listForClaim(auth: AuthContext, claimId: string) {
  const rows = await repo.listForClaim(claimId);
  if (rows === undefined) throw new ClaimNotFoundError(claimId);
  return rows;
}

/**
 * Asks the insurer for more cover, and moves the claim to say so
 * (docs/adr/0004).
 */
export async function requestEnhancement(
  auth: AuthContext,
  claimId: string,
  body: RequestEnhancementBody,
) {
  const claim = await claimsRepository.getClaimById(claimId);
  if (!claim) throw new ClaimNotFoundError(claimId);

  const open = await repo.getOpenForClaim(claimId);
  if (open) {
    throw new EnhancementAlreadyOpenError(
      `an enhancement for ${open.requestedAmount} is already with the insurer`,
    );
  }

  const memberId = await getMemberId(auth.userId);
  const created = await repo.create(
    claimId,
    {
      requestedAmount: body.requestedAmount,
      reason: body.reason,
      slaDeadline: slaDeadlineFor("ENHANCEMENT_REQUESTED", new Date()),
    },
    memberId,
  );
  if (!created) throw new ClaimNotFoundError(claimId);

  // The claim's own status follows the request, through the state machine
  // rather than around it.
  if (canTransition(claim.status, "ENHANCEMENT_REQUESTED", auth.role)) {
    // The result is deliberately ignored, as it always has been.
    await claimsRepository.recordStatusChange(
      claimId,
      "ENHANCEMENT_REQUESTED",
      memberId,
      created.slaDeadline ?? undefined,
      claim.status,
    );
  }

  await auditService.record(auth, {
    action: "enhancement.requested",
    entityType: "claim",
    entityId: claimId,
    after: {
      enhancementId: created.id,
      requestedAmount: body.requestedAmount,
      reason: body.reason,
    },
    actorId: memberId,
  });

  return created;
}

/**
 * Records what the insurer said, and raises the claim's ceiling by what it
 * granted.
 */
export async function decideEnhancement(
  auth: AuthContext,
  enhancementId: string,
  body: DecideEnhancementBody,
) {
  const existing = await repo.getById(enhancementId);
  if (!existing) throw new EnhancementNotFoundError(enhancementId);
  if (existing.status !== "REQUESTED") {
    throw new EnhancementAlreadyDecidedError(
      `this enhancement was already ${existing.status}`,
    );
  }

  const updated = await repo.decide(
    enhancementId,
    body.outcome,
    body.approvedAmount,
  );
  if (!updated) throw new EnhancementNotFoundError(enhancementId);

  const memberId = await getMemberId(auth.userId);
  await auditService.record(auth, {
    action: "enhancement.decided",
    entityType: "claim",
    entityId: existing.claimId,
    before: { status: existing.status },
    after: {
      enhancementId,
      status: body.outcome,
      approvedAmount: body.approvedAmount ?? null,
    },
    actorId: memberId,
  });

  return updated;
}
