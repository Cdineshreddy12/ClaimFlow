import { and, desc, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { claims, insurers, procedures, queries } from "../../db/schema.js";
import { getClaimById } from "../claims/claims.repository.js";
import type { CreateQueryInput, UpdateQueryBody } from "./queries.schema.js";

/** Queries belong to a claim, which belongs to an organization — same boundary rule as every other module, see docs/adr/0002. */

export async function listForClaim(claimId: string) {
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;
  return db
    .select()
    .from(queries)
    .where(eq(queries.claimId, claimId))
    .orderBy(desc(queries.createdAt));
}

export async function create(claimId: string, data: CreateQueryInput) {
  const claim = await getClaimById(claimId);
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

export async function getById(id: string) {
  const [row] = await db.select().from(queries).where(eq(queries.id, id));
  return row;
}

export async function update(id: string, data: UpdateQueryBody) {
  const existing = await getById(id);
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

export async function markReplied(id: string) {
  const existing = await getById(id);
  if (!existing) return undefined;
  const [updated] = await db
    .update(queries)
    .set({ replySentAt: new Date() })
    .where(eq(queries.id, id))
    .returning();
  return updated;
}

/**
 * The brief's "Query Inbox" screen, which spans claims rather than
 * living inside one. assignedTo mirrors claims.service's desk_executive
 * scoping: an exec sees queries on their own claims, a desk head sees
 * the lot.
 */
export async function listInbox(filters: {
  status: "open" | "replied" | "all";
  assignedTo?: string | null;
}) {
  const conditions = [];
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
