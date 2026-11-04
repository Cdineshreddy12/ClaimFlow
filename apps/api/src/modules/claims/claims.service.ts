import { and, eq } from "drizzle-orm";
import {
  canTransition,
  type ClaimStatus,
  type Role,
} from "@claimflow/contracts";
import { db } from "../../db/client.js";
import { orgMembers } from "../../db/schema.js";
import * as claimsRepository from "./claims.repository.js";
import type { CreateClaimBody, ListClaimsQuery } from "./claims.schema.js";

export class ClaimNotFoundError extends Error {}
export class InvalidTransitionError extends Error {}

interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * desk_executive sees only their own assigned claims, regardless of what
 * the request asked for — this is the role-filtering half of the tenant
 * boundary described in docs/adr/0002 (the repository layer only enforces
 * the org half). desk_head and everyone above sees the full org.
 */
export async function listClaims(auth: AuthContext, query: ListClaimsQuery) {
  const statusFilter =
    query.status !== undefined ? { status: query.status } : {};
  const forceOwnClaimsOnly =
    auth.role === "desk_executive" || query.scope === "mine";

  if (forceOwnClaimsOnly) {
    const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
    return claimsRepository.listClaims(auth.organizationId, {
      ...statusFilter,
      assignedTo: memberId,
    });
  }

  return claimsRepository.listClaims(auth.organizationId, statusFilter);
}

export async function getClaim(auth: AuthContext, id: string) {
  const claim = await claimsRepository.getClaimById(auth.organizationId, id);
  if (!claim) throw new ClaimNotFoundError(id);

  if (auth.role === "desk_executive") {
    const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
    if (claim.assignedTo !== memberId) throw new ClaimNotFoundError(id);
  }

  return claim;
}

export async function createClaim(auth: AuthContext, body: CreateClaimBody) {
  return claimsRepository.createClaim(auth.organizationId, body);
}

export async function transitionClaimStatus(
  auth: AuthContext,
  claimId: string,
  nextStatus: ClaimStatus,
  slaDeadline: Date | undefined,
) {
  const claim = await claimsRepository.getClaimById(
    auth.organizationId,
    claimId,
  );
  if (!claim) throw new ClaimNotFoundError(claimId);

  if (!canTransition(claim.status, nextStatus, auth.role)) {
    throw new InvalidTransitionError(
      `${claim.status} -> ${nextStatus} not allowed for ${auth.role}`,
    );
  }

  const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
  const updated = await claimsRepository.recordStatusChange(
    auth.organizationId,
    claimId,
    nextStatus,
    memberId,
    slaDeadline,
  );
  if (!updated) throw new ClaimNotFoundError(claimId);
  return updated;
}

async function getOrgMemberId(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.userId, userId),
      ),
    );
  return member?.id ?? null;
}
