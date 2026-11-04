import { and, eq, getTableColumns } from "drizzle-orm";
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
    })
    .from(claims)
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(eq(claims.id, id));
  return claim;
}

export async function createClaim(
  data: CreateClaimBody,
  checklistSnapshot: ChecklistSnapshotItem[],
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
      checklistSnapshot,
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
  facts: { admittedAt?: Date; billedAmount?: string },
) {
  if (facts.admittedAt === undefined && facts.billedAmount === undefined) {
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
      updatedAt: new Date(),
    })
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
