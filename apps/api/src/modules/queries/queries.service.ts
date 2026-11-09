import type { Role } from "@claimflow/contracts";
import { emailSentAt } from "../../lib/email-date.js";
import { getSummariser } from "../../integrations/summariser/claude.js";
import * as auditService from "../audit/audit.service.js";
import { getMemberId } from "../members/members.repository.js";
import * as queriesRepository from "./queries.repository.js";
import type {
  ConfirmDeadlineBody,
  CreateQueryBody,
  CreateQueryInput,
  ListInboxQuery,
  UpdateQueryBody,
} from "./queries.schema.js";

export class ClaimNotFoundError extends Error {}
export class QueryNotFoundError extends Error {}
/** Nothing to re-read — the query has no stored email. */
export class NothingToSummariseError extends Error {}
/** No API key configured, so a retry would fail the same way. */
export class SummariserUnavailableError extends Error {}
/** The retry ran and lost; the query stays marked failed. */
export class SummarisationFailedError extends Error {}

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
  /*
    The same email pasted onto the same claim moments ago is the same
    paste, not a second query. Checked before the model runs, so a
    retry after a timeout costs nothing and returns what the first
    attempt actually stored — including a summary the desk never got
    to see land.
  */
  const duplicate = await queriesRepository.findRecentDuplicate(
    claimId,
    body.tpaRawEmail,
    new Date(),
  );
  if (duplicate) return duplicate;

  // Only fill what the desk left blank. Someone who typed their own
  // summary has already read the email, and overwriting that would be
  // the model second-guessing a human who was there.
  const enriched = await summariseIfBlank(body);

  // A deadline that came in on the body was typed by the person
  // pasting the email, so it is confirmed on arrival. One the
  // summariser derived is not, and waits for a click — docs/adr/0005.
  if (body.deadline) {
    enriched.deadlineConfirmedBy = await getMemberId(auth.userId);
    enriched.deadlineConfirmedAt = new Date();
  }

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
  // Nothing to fill, so nothing was attempted — which is the truth,
  // and distinct from an attempt that came back empty.
  if (!needsSummary && !needsItems && !needsDeadline) return body;

  const summariser = getSummariser();
  if (!summariser || !body.tpaRawEmail) return body;

  try {
    // The TPA's clock, not ours. "Within 48 hours" runs from when they
    // sent it; anchoring it to the paste would quietly hand the desk
    // the hours between. Only a paste with no readable header falls
    // back to now, where the email is presumably fresh anyway.
    const now = new Date();
    const result = await summariser.summarise({
      rawEmail: body.tpaRawEmail,
      sentAt: emailSentAt(body.tpaRawEmail, now) ?? now,
    });
    return {
      ...body,
      summarisationStatus: "ok",
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
    // Recorded, not just logged: a server log is no use to the desk
    // exec looking at the empty summary, and this is what lets the
    // panel offer them a retry.
    return { ...body, summarisationStatus: "failed" };
  }
}

/**
 * Runs the summariser again on a query whose first attempt failed.
 *
 * The one place a button for this belongs: the automatic attempt has
 * already happened and lost, and only a human knows whether the email
 * is worth another call. Still fills blanks only — a desk exec who
 * gave up and typed the summary themselves keeps it.
 */
export async function resummarise(auth: AuthContext, id: string) {
  const existing = await queriesRepository.getById(id);
  if (!existing) throw new QueryNotFoundError(id);
  if (!existing.tpaRawEmail) throw new NothingToSummariseError(id);

  const summariser = getSummariser();
  if (!summariser) throw new SummariserUnavailableError();

  const needsSummary = !existing.aiSummary;
  const needsItems = (existing.requestedItems as string[]).length === 0;
  const needsDeadline = !existing.deadline;

  let saved;
  try {
    const now = new Date();
    const result = await summariser.summarise({
      rawEmail: existing.tpaRawEmail,
      sentAt: emailSentAt(existing.tpaRawEmail, now) ?? now,
    });
    saved = await queriesRepository.saveSummarisation(id, {
      summarisationStatus: "ok",
      ...(needsSummary ? { aiSummary: result.summary } : {}),
      ...(needsItems ? { requestedItems: result.requestedItems } : {}),
      ...(needsDeadline && result.deadline
        ? {
            deadline: new Date(result.deadline),
            deadlineInferred: result.deadlineInferred,
          }
        : {}),
    });
  } catch (err) {
    console.error("query re-summarisation failed", {
      queryId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Left failed, so the retry stays on offer rather than the button
    // vanishing on a second failure.
    await queriesRepository.saveSummarisation(id, {
      summarisationStatus: "failed",
    });
    throw new SummarisationFailedError(id);
  }

  await auditService.record(auth, {
    action: "query.resummarised",
    entityType: "query",
    entityId: id,
    before: {
      summarisationStatus: existing.summarisationStatus,
      hadSummary: Boolean(existing.aiSummary),
    },
    after: { summarisationStatus: "ok" },
  });

  return saved;
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
  // Only looked up when a deadline is in play — every other edit here
  // is attributed by the audit record alone, and a round trip to
  // members for nothing is a round trip for nothing.
  const editedBy =
    body.deadline !== undefined ? await getMemberId(auth.userId) : null;

  const updated = await queriesRepository.update(id, body, editedBy);
  if (!updated) throw new QueryNotFoundError(id);

  await auditService.record(auth, {
    action: "query.updated",
    entityType: "query",
    entityId: id,
    after: { fields: Object.keys(body) },
  });

  return updated;
}

/**
 * The human-confirm step docs/adr/0005 requires on the reply deadline.
 *
 * The summariser writes `deadline` straight into the column the inbox
 * sorts by and the dashboard counts overdue off — unlike a document's
 * slot or a pre-auth value, which sit in suggestion columns until
 * someone clicks. This is that click. Before it, the countdown renders
 * as unconfirmed and says where the date came from; after it, a named
 * member stands behind the date a claim is being chased against.
 *
 * `deadline` omitted confirms what's stored, a value overrides it, and
 * null says the desk read the email and there is no deadline at all.
 */
export async function confirmDeadline(
  auth: AuthContext,
  id: string,
  body: ConfirmDeadlineBody,
) {
  const existing = await queriesRepository.getById(id);
  if (!existing) throw new QueryNotFoundError(id);

  const memberId = await getMemberId(auth.userId);
  const updated = await queriesRepository.confirmDeadline(
    id,
    body.deadline,
    memberId,
  );
  if (!updated) throw new QueryNotFoundError(id);

  await auditService.record(auth, {
    action: "query.deadline_confirmed",
    entityType: "query",
    entityId: id,
    // What the model proposed, next to what the desk accepted — the
    // same before/after shape preauth.field_confirmed records, so an
    // audit of "where was the AI wrong" reads the same for both.
    before: {
      deadline: existing.deadline,
      deadlineInferred: existing.deadlineInferred,
    },
    after: { deadline: updated.deadline, changed: body.deadline !== undefined },
    actorId: memberId,
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
