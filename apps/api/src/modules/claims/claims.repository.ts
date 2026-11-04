import { and, eq } from "drizzle-orm";
import type { ClaimStatus } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import { claimStatusEvents, claims } from "../../db/schema.js";
import type { CreateClaimBody } from "./claims.schema.js";

/**
 * Every function here takes organizationId and filters by it — this is
 * not optional decoration, it's the actual tenant boundary for this API.
 * See docs/adr/0002: RLS does not protect queries made through Drizzle,
 * because the API connects as the postgres superuser. This file is the
 * one place that boundary has to be gotten right.
 */

export async function listClaims(
  organizationId: string,
  filters: { status?: ClaimStatus; assignedTo?: string | null },
) {
  const conditions = [eq(claims.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(claims.status, filters.status));
  if (filters.assignedTo)
    conditions.push(eq(claims.assignedTo, filters.assignedTo));

  return db
    .select()
    .from(claims)
    .where(and(...conditions));
}

export async function getClaimById(organizationId: string, id: string) {
  const [claim] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.id, id), eq(claims.organizationId, organizationId)));
  return claim;
}

export async function createClaim(
  organizationId: string,
  data: CreateClaimBody,
) {
  const [claim] = await db
    .insert(claims)
    .values({
      organizationId,
      patientName: data.patientName,
      insurerId: data.insurerId,
      procedureId: data.procedureId,
      billedAmount:
        data.billedAmount !== undefined ? data.billedAmount.toString() : null,
      admittedAt: data.admittedAt ?? null,
    })
    .returning();
  // We just inserted exactly one row — this is never actually absent.
  return claim!;
}

/**
 * Updates status and appends the timeline event in one call — the two
 * must never drift apart. Does not validate the transition itself; that's
 * claims.service.ts's job, using the shared state machine in
 * @claimflow/contracts so the API and the UI agree on what's legal.
 */
export async function recordStatusChange(
  organizationId: string,
  claimId: string,
  status: ClaimStatus,
  actorId: string | null,
  slaDeadline: Date | undefined,
) {
  const [updated] = await db
    .update(claims)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)),
    )
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
