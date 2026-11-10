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
 * Asks the insurer for more cover, and moves the claim to say so.
 *
 * Refuses a second open request on the same claim. Two live
 * enhancements against one admission is not a workflow an insurer will
 * answer — it's two desk execs who didn't know about each other, and
 * the right outcome is an error that says so rather than a duplicate
 * the TPA gets to pick between.
 *
 * The deadline is stamped here from the shared window, never taken
 * from the caller: docs/adr/0004 requires SLA clocks to be server-side,
 * and a client-supplied deadline is a client-chosen one.
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

  /*
    The claim's own status follows the request, through the state
    machine rather than around it.

    This used to write straight to the repository and swallow any
    failure, with a comment explaining that an approved claim can still
    need more money. That was true, and the fix belonged in the
    transition table — which now permits it — rather than in a bypass.
    Writing the status without consulting `canTransition` meant the one
    structure guaranteeing a claim cannot move illegally had a door in
    the back of it.

    Still never fatal: a claim at final bill or already settled can
    legitimately have an enhancement recorded against it for the
    history, and losing that record because the claim has moved on
    would discard the fact that matters most here.
  */
  if (canTransition(claim.status, "ENHANCEMENT_REQUESTED", auth.role)) {
    /*
      The result is deliberately ignored, as it always has been. The
      write now refuses if the claim has moved since `claim` was read,
      and a claim that has moved on is exactly the case the comment
      above calls legitimate: the enhancement is recorded either way,
      which is the fact that matters here.
    */
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
 * Records what the insurer said, and raises the claim's ceiling by what
 * it granted.
 *
 * A decided enhancement is never re-decided: the amount granted has
 * already been added to the claim's sanctioned amount, so a second
 * decision would add it twice. Correcting a mis-entered outcome is a
 * new fact, not an edit of this one.
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
