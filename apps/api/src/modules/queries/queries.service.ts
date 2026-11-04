import type { Role } from "@claimflow/contracts";
import { getSummariser } from "../../integrations/summariser/claude.js";
import * as auditService from "../audit/audit.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as queriesRepository from "./queries.repository.js";
import type {
  CreateQueryBody,
  CreateQueryInput,
  ListInboxQuery,
  UpdateQueryBody,
} from "./queries.schema.js";

export class ClaimNotFoundError extends Error {}
export class QueryNotFoundError extends Error {}

interface AuthContext {
  userId: string;
  role: Role;
}

export async function listForClaim(auth: AuthContext, claimId: string) {
  const result = await queriesRepository.listForClaim(claimId);
  if (result === undefined) throw new ClaimNotFoundError(claimId);
  return result;
}

export async function createQuery(
  auth: AuthContext,
  claimId: string,
  body: CreateQueryBody,
) {
  // Only fill what the desk left blank. Someone who typed their own
  // summary has already read the email, and overwriting that would be
  // the model second-guessing a human who was there.
  const enriched = await summariseIfBlank(body);

  const created = await queriesRepository.create(claimId, enriched);
  if (!created) throw new ClaimNotFoundError(claimId);

  await auditService.record(auth, {
    action: "query.created",
    entityType: "query",
    entityId: created.id,
    after: { claimId },
  });

  return created;
}

/**
 * Generates the summary, requested items and deadline from the raw
 * email when they weren't supplied.
 *
 * Never throws: the query itself is what matters, and failing the
 * create because a summary couldn't be produced would lose the email a
 * desk exec just pasted. A failure simply leaves the fields blank,
 * which is the pre-AI behaviour.
 */
async function summariseIfBlank(
  body: CreateQueryBody,
): Promise<CreateQueryInput> {
  const needsSummary = !body.aiSummary;
  const needsItems = !body.requestedItems || body.requestedItems.length === 0;
  const needsDeadline = !body.deadline;
  if (!needsSummary && !needsItems && !needsDeadline) return body;

  const summariser = getSummariser();
  if (!summariser || !body.tpaRawEmail) return body;

  try {
    const result = await summariser.summarise({
      rawEmail: body.tpaRawEmail,
      receivedAt: new Date(),
    });
    return {
      ...body,
      ...(needsSummary ? { aiSummary: result.summary } : {}),
      ...(needsItems ? { requestedItems: result.requestedItems } : {}),
      ...(needsDeadline && result.deadline
        ? { deadline: new Date(result.deadline) }
        : {}),
      ...(needsSummary ? { summarisedBy: "claude" } : {}),
      ...(needsDeadline && result.deadline
        ? { deadlineInferred: result.deadlineInferred }
        : {}),
    };
  } catch (err) {
    console.error("query summarisation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return body;
  }
}

export async function getQuery(auth: AuthContext, id: string) {
  const query = await queriesRepository.getById(id);
  if (!query) throw new QueryNotFoundError(id);
  return query;
}

export async function updateQuery(
  auth: AuthContext,
  id: string,
  body: UpdateQueryBody,
) {
  const updated = await queriesRepository.update(id, body);
  if (!updated) throw new QueryNotFoundError(id);

  await auditService.record(auth, {
    action: "query.updated",
    entityType: "query",
    entityId: id,
    after: { fields: Object.keys(body) },
  });

  return updated;
}

/** Marking a reply sent here only records that the desk exec sent it through whatever channel — nothing goes out automatically, see docs/adr/0005. */
export async function markReplied(auth: AuthContext, id: string) {
  const updated = await queriesRepository.markReplied(id);
  if (!updated) throw new QueryNotFoundError(id);

  await auditService.record(auth, {
    action: "query.replied",
    entityType: "query",
    entityId: id,
    after: { replySentAt: updated.replySentAt },
  });

  return updated;
}

/**
 * desk_executive sees only queries on their own assigned claims, same
 * rule as claims.service.listClaims — see docs/adr/0002.
 */
export async function listInbox(auth: AuthContext, query: ListInboxQuery) {
  if (auth.role === "desk_executive") {
    const memberId = await getMemberId(auth.userId);
    return queriesRepository.listInbox({
      status: query.status,
      assignedTo: memberId,
    });
  }
  return queriesRepository.listInbox({
    status: query.status,
  });
}
