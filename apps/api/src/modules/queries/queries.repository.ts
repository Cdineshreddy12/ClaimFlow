import { and, desc, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { claims, insurers, procedures, queries } from "../../db/schema.js";
import { getClaimById } from "../claims/claims.repository.js";
import type { CreateQueryInput, UpdateQueryBody } from "./queries.schema.js";

/** Queries belong to a claim, which belongs to an organization — same boundary rule as every other module, see docs/adr/0002. */

export async function listForClaim(organizationId: string, claimId: string) {
  const claim = await getClaimById(organizationId, claimId);
  if (!claim) return undefined;
  return db
    .select()
    .from(queries)
    .where(eq(queries.claimId, claimId))
    .orderBy(desc(queries.createdAt));
}

export async function create(
  organizationId: string,
  claimId: string,
  data: CreateQueryInput,
) {
  const claim = await getClaimById(organizationId, claimId);
  if (!claim) return undefined;
  const [query] = await db
    .insert(queries)
    .values({
      claimId,
      tpaRawEmail: data.tpaRawEmail,
      aiSummary: data.aiSummary ?? null,
      requestedItems: data.requestedItems,
      deadline: data.deadline ?? null,
      summarisedBy: data.summarisedBy ?? null,
      deadlineInferred: data.deadlineInferred ?? false,
    })
    .returning();
  return query;
}

/** Scoped by joining through claims, since a bare query id doesn't carry organizationId on its own. */
export async function getById(organizationId: string, id: string) {
  const [row] = await db
    .select({ query: queries })
    .from(queries)
    .innerJoin(claims, eq(queries.claimId, claims.id))
    .where(and(eq(queries.id, id), eq(claims.organizationId, organizationId)));
  return row?.query;
}

export async function update(
  organizationId: string,
  id: string,
  data: UpdateQueryBody,
) {
  const existing = await getById(organizationId, id);
  if (!existing) return undefined;

  const patch: Partial<typeof queries.$inferInsert> = {};
  if (data.aiSummary !== undefined) patch.aiSummary = data.aiSummary;
  if (data.requestedItems !== undefined)
    patch.requestedItems = data.requestedItems;
  if (data.deadline !== undefined) patch.deadline = data.deadline;

  const [updated] = await db
    .update(queries)
    .set(patch)
    .where(eq(queries.id, id))
    .returning();
  return updated;
}

export async function markReplied(organizationId: string, id: string) {
  const existing = await getById(organizationId, id);
  if (!existing) return undefined;
  const [updated] = await db
    .update(queries)
    .set({ replySentAt: new Date() })
    .where(eq(queries.id, id))
    .returning();
  return updated;
}

/**
 * Org-wide inbox listing — the brief's "Query Inbox" screen, which spans
 * claims rather than living inside one. assignedTo mirrors
 * claims.service's desk_executive scoping: forced to their own assigned
 * claims' queries, not an org-wide view.
 */
export async function listInbox(
  organizationId: string,
  filters: { status: "open" | "replied" | "all"; assignedTo?: string | null },
) {
  const conditions = [eq(claims.organizationId, organizationId)];
  if (filters.status === "open") conditions.push(isNull(queries.replySentAt));
  if (filters.status === "replied")
    conditions.push(isNotNull(queries.replySentAt));
  if (filters.assignedTo)
    conditions.push(eq(claims.assignedTo, filters.assignedTo));

  return db
    .select({
      id: queries.id,
      claimId: queries.claimId,
      tpaRawEmail: queries.tpaRawEmail,
      aiSummary: queries.aiSummary,
      summarisedBy: queries.summarisedBy,
      requestedItems: queries.requestedItems,
      deadline: queries.deadline,
      deadlineInferred: queries.deadlineInferred,
      replySentAt: queries.replySentAt,
      createdAt: queries.createdAt,
      claimPatientName: claims.patientName,
      claimStatus: claims.status,
      insurerName: insurers.name,
      procedureName: procedures.name,
    })
    .from(queries)
    .innerJoin(claims, eq(queries.claimId, claims.id))
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(and(...(conditions as SQL[])))
    .orderBy(queries.deadline);
}
