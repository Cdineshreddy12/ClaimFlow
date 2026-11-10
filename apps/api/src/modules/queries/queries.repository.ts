import { and, desc, eq, gte, isNotNull, isNull, type SQL } from "drizzle-orm";
import type { SummarisationStatus } from "@claimflow/contracts";
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
      summarisationStatus: data.summarisationStatus ?? "not_attempted",
      deadlineInferred: data.deadlineInferred ?? false,
      deadlineConfirmedBy: data.deadlineConfirmedBy ?? null,
      deadlineConfirmedAt: data.deadlineConfirmedAt ?? null,
    })
    .returning();
  return query;
}

/** How long an identical paste counts as the same paste. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** The same email, on the same claim, logged moments ago. */
export async function findRecentDuplicate(
  claimId: string,
  tpaRawEmail: string,
  now: Date,
) {
  const [row] = await db
    .select()
    .from(queries)
    .where(
      and(
        eq(queries.claimId, claimId),
        eq(queries.tpaRawEmail, tpaRawEmail),
        gte(queries.createdAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(queries.createdAt))
    .limit(1);
  return row;
}

/** Writes a re-run's result onto a query that already exists. */
export async function saveSummarisation(
  id: string,
  data: {
    summarisationStatus: SummarisationStatus;
    aiSummary?: string | undefined;
    requestedItems?: string[] | undefined;
    deadline?: Date | undefined;
    deadlineInferred?: boolean | undefined;
  },
) {
  const patch: Partial<typeof queries.$inferInsert> = {
    summarisationStatus: data.summarisationStatus,
  };
  if (data.aiSummary !== undefined) {
    patch.aiSummary = data.aiSummary;
    patch.summarisedBy = "claude";
  }
  if (data.requestedItems !== undefined)
    patch.requestedItems = data.requestedItems;
  if (data.deadline !== undefined) {
    // Unconfirmed, like any summariser deadline — docs/adr/0005.
    patch.deadline = data.deadline;
    patch.deadlineInferred = data.deadlineInferred ?? false;
  }

  const [updated] = await db
    .update(queries)
    .set(patch)
    .where(eq(queries.id, id))
    .returning();
  return updated;
}

export async function getById(id: string) {
  const [row] = await db.select().from(queries).where(eq(queries.id, id));
  return row;
}

export async function update(
  id: string,
  data: UpdateQueryBody,
  editedBy: string | null = null,
) {
  const existing = await getById(id);
  if (!existing) return undefined;

  const patch: Partial<typeof queries.$inferInsert> = {};
  if (data.aiSummary !== undefined) patch.aiSummary = data.aiSummary;
  if (data.requestedItems !== undefined)
    patch.requestedItems = data.requestedItems;
  if (data.deadline !== undefined) {
    // A deadline arriving through an edit was typed by a human, so it is
    // confirmed and no longer inferred by the same keystroke.
    patch.deadline = data.deadline;
    patch.deadlineInferred = false;
    patch.deadlineConfirmedBy = editedBy;
    patch.deadlineConfirmedAt = new Date();
  }

  const [updated] = await db
    .update(queries)
    .set(patch)
    .where(eq(queries.id, id))
    .returning();
  return updated;
}

/** Stamps a human against the reply deadline, optionally replacing it. */
export async function confirmDeadline(
  id: string,
  deadline: Date | null | undefined,
  confirmedBy: string | null,
) {
  const existing = await getById(id);
  if (!existing) return undefined;

  const patch: Partial<typeof queries.$inferInsert> = {
    deadlineConfirmedBy: confirmedBy,
    deadlineConfirmedAt: new Date(),
  };
  if (deadline !== undefined) {
    patch.deadline = deadline;
    patch.deadlineInferred = false;
  }

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
 * The brief's "Query Inbox" screen, which spans claims rather than living
 * inside one.
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
      claimReference: claims.reference,
      tpaRawEmail: queries.tpaRawEmail,
      aiSummary: queries.aiSummary,
      summarisedBy: queries.summarisedBy,
      summarisationStatus: queries.summarisationStatus,
      requestedItems: queries.requestedItems,
      deadline: queries.deadline,
      deadlineInferred: queries.deadlineInferred,
      deadlineConfirmedAt: queries.deadlineConfirmedAt,
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
