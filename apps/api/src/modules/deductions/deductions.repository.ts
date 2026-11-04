import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DeductionReason } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import { claims, deductions } from "../../db/schema.js";
import { getClaimById } from "../claims/claims.repository.js";

export async function create(
  claimId: string,
  data: { reason: DeductionReason; amount: number; note?: string | undefined },
  recordedBy: string | null,
) {
  // Org scoping comes through the claim, like documents and queries.
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;

  const [row] = await db
    .insert(deductions)
    .values({
      claimId,
      reason: data.reason,
      amount: data.amount.toString(),
      note: data.note || null,
      recordedBy,
    })
    .returning();
  return row;
}

export async function listForClaim(claimId: string) {
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;
  return db
    .select()
    .from(deductions)
    .where(eq(deductions.claimId, claimId))
    .orderBy(desc(deductions.createdAt));
}

/**
 * Totals per reason for the dashboard. Aggregated in Postgres rather
 * than by pulling every row into the API — a desk doing ~650 admissions
 * a month accumulates deductions fast, and this runs on every dashboard
 * load.
 */
export async function sumByReasonSince(since: Date) {
  return db
    .select({
      reason: deductions.reason,
      total: sql<string>`sum(${deductions.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(deductions)
    .innerJoin(claims, eq(deductions.claimId, claims.id))
    .where(and(gte(deductions.createdAt, since)))
    .groupBy(deductions.reason);
}
