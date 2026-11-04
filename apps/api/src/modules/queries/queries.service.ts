import type { Role } from "@claimflow/contracts";
import { getOrgMemberId } from "../org-members/org-members.repository.js";
import * as queriesRepository from "./queries.repository.js";
import type {
  CreateQueryBody,
  ListInboxQuery,
  UpdateQueryBody,
} from "./queries.schema.js";

export class ClaimNotFoundError extends Error {}
export class QueryNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

export async function listForClaim(auth: AuthContext, claimId: string) {
  const result = await queriesRepository.listForClaim(
    auth.organizationId,
    claimId,
  );
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

export async function createQuery(
  auth: AuthContext,
  claimId: string,
  body: CreateQueryBody,
) {
  const created = await queriesRepository.create(
    auth.organizationId,
    claimId,
    body,
  );
  if (!created) throw new ClaimNotFoundError(claimId);
  return created;
}

export async function getQuery(auth: AuthContext, id: string) {
  const query = await queriesRepository.getById(auth.organizationId, id);
  if (!query) throw new QueryNotFoundError(id);
  return query;
}

export async function updateQuery(
  auth: AuthContext,
  id: string,
  body: UpdateQueryBody,
) {
  const updated = await queriesRepository.update(auth.organizationId, id, body);
  if (!updated) throw new QueryNotFoundError(id);
  return updated;
}

/** Marking a reply sent here only records that the desk exec sent it through whatever channel — nothing goes out automatically, see docs/adr/0005. */
export async function markReplied(auth: AuthContext, id: string) {
  const updated = await queriesRepository.markReplied(auth.organizationId, id);
  if (!updated) throw new QueryNotFoundError(id);
  return updated;
}

/**
 * desk_executive sees only queries on their own assigned claims, same
 * rule as claims.service.listClaims — see docs/adr/0002.
 */
export async function listInbox(auth: AuthContext, query: ListInboxQuery) {
  if (auth.role === "desk_executive") {
    const memberId = await getOrgMemberId(auth.organizationId, auth.userId);
    return queriesRepository.listInbox(auth.organizationId, {
      status: query.status,
      assignedTo: memberId,
    });
  }
  return queriesRepository.listInbox(auth.organizationId, {
    status: query.status,
  });
}
