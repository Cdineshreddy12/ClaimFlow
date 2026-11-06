import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { ClaimStatus } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import {
  claimStatusEvents,
  claims,
  insurers,
  procedures,
} from "../../db/schema.js";
import type {
  ChecklistSnapshotItem,
  CreateClaimBody,
} from "./claims.schema.js";

/**
 * One hospital per install, so there is no tenant predicate here any
 * more (docs/adr/0002). What still matters is `assignedTo`: a desk
 * executive sees their own claims, a desk head sees all of them, and
 * that filter is applied by the service, not assumed here.
 */

export async function listClaims(filters: {
  status?: ClaimStatus;
  assignedTo?: string | null;
}) {
  const conditions = [];
  if (filters.status) conditions.push(eq(claims.status, filters.status));
  if (filters.assignedTo)
    conditions.push(eq(claims.assignedTo, filters.assignedTo));

  return db
    .select({
      ...getTableColumns(claims),
      insurerName: insurers.name,
      procedureName: procedures.name,
    })
    .from(claims)
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

/** Joins insurer/procedure names on — anything rendering a single claim needs a name, not a bare id. */
export async function getClaimById(id: string) {
  const [claim] = await db
    .select({
      ...getTableColumns(claims),
      insurerName: insurers.name,
      procedureName: procedures.name,
      /**
       * The clock the claim is currently on, from its latest status
       * event. A correlated subquery rather than a join so one claim
       * stays one row — and it belongs here because every surface that
       * renders a claim also has to say whether it's late (docs/adr/0014).
       */
      slaDeadline: sql<string | null>`(
        select e.sla_deadline
        from claim_status_events e
        where e.claim_id = ${claims.id}
        order by e.created_at desc
        limit 1
      )`,
    })
    .from(claims)
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(eq(claims.id, id));
  return claim;
}

export async function createClaim(
  data: CreateClaimBody & { sanctionedAmount?: number },
  checklistSnapshot: ChecklistSnapshotItem[],
  preauthLayoutSnapshot?: unknown,
) {
  const [claim] = await db
    .insert(claims)
    .values({
      patientName: data.patientName,
      insurerId: data.insurerId,
      procedureId: data.procedureId,
      billedAmount:
        data.billedAmount !== undefined ? data.billedAmount.toString() : null,
      admittedAt: data.admittedAt ?? null,
      // Government scheme claims only — the service refuses these on
      // any other payer. Both or neither, enforced in the database too.
      packageCode: data.packageCode ?? null,
      packageRate:
        data.packageRate !== undefined ? data.packageRate.toString() : null,
      sanctionedAmount:
        data.sanctionedAmount !== undefined
          ? data.sanctionedAmount.toString()
          : null,
      checklistSnapshot,
      ...(preauthLayoutSnapshot !== undefined ? { preauthLayoutSnapshot } : {}),
    })
    .returning();
  // We just inserted exactly one row — this is never actually absent.
  return claim!;
}

/**
 * Writes back the two facts the claim header and the dashboard already
 * read off columns, once a human has confirmed them on the pre-auth form.
 *
 * Without this there'd be two answers to "when was this patient
 * admitted" — the pre-auth field and `claims.admittedAt` — and the
 * dashboard would keep showing the one nobody filled in. Only ever
 * called on confirmation, never from a suggestion.
 */
export async function updateConfirmedFacts(
  claimId: string,
  facts: {
    admittedAt?: Date;
    billedAmount?: string;
    /** What the insurer authorised — see docs/adr/0012. */
    sanctionedAmount?: string;
  },
) {
  if (
    facts.admittedAt === undefined &&
    facts.billedAmount === undefined &&
    facts.sanctionedAmount === undefined
  ) {
    return undefined;
  }
  const [updated] = await db
    .update(claims)
    .set({
      ...(facts.admittedAt !== undefined
        ? { admittedAt: facts.admittedAt }
        : {}),
      ...(facts.billedAmount !== undefined
        ? { billedAmount: facts.billedAmount }
        : {}),
      ...(facts.sanctionedAmount !== undefined
        ? { sanctionedAmount: facts.sanctionedAmount }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Appends one slot to a single claim's checklist snapshot.
 *
 * Concatenated in SQL rather than read-modify-written: two documents
 * being filed into new slots at the same moment would otherwise race,
 * and one of them would be silently dropped.
 */
export async function addChecklistSlot(
  claimId: string,
  item: ChecklistSnapshotItem,
) {
  const [updated] = await db
    .update(claims)
    .set({
      checklistSnapshot: sql`${claims.checklistSnapshot} || ${JSON.stringify([item])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Takes one slot back off a single claim's snapshot.
 *
 * Filtered in SQL for the same reason the append is concatenated
 * there: a read-modify-write would lose a concurrent addition, and
 * these are the two halves of the same edit.
 */
export async function removeChecklistSlot(
  claimId: string,
  documentType: string,
) {
  const [updated] = await db
    .update(claims)
    .set({
      checklistSnapshot: sql`(
        select coalesce(jsonb_agg(item), '[]'::jsonb)
        from jsonb_array_elements(${claims.checklistSnapshot}) item
        where item->>'documentType' <> ${documentType}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Records what the insurer actually paid, and when.
 *
 * Separate from `sanctionedAmount`: that is what they authorised, this
 * is what arrived. The difference is the deduction the desk is trying
 * to shrink, so inferring one from the other would make the deductions
 * dashboard circular.
 */
export async function recordPayment(
  claimId: string,
  settledAmount: string,
  settledOn: string,
) {
  const [updated] = await db
    .update(claims)
    .set({ settledAmount, settledOn, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Updates status and appends the timeline event in one call — the two
 * must never drift apart. Does not validate the transition itself; that's
 * claims.service.ts's job, using the shared state machine in
 * @claimflow/contracts so the API and the UI agree on what's legal.
 */
export async function recordStatusChange(
  claimId: string,
  status: ClaimStatus,
  actorId: string | null,
  slaDeadline: Date | undefined,
) {
  const [updated] = await db
    .update(claims)
    .set({ status, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning();

  if (!updated) return undefined;

  await db.insert(claimStatusEvents).values({
    claimId,
    status,
    actorId,
    slaDeadline: slaDeadline ?? null,
  });

  return updated;
}
