import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type {
  DeductionAppealStatus,
  DeductionReason,
} from "@claimflow/contracts";
import { db } from "../../db/client.js";
import { claims, deductions, insurers } from "../../db/schema.js";
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

/** Totals per reason for the dashboard. */
export async function sumByReasonSince(since: Date, until?: Date) {
  return db
    .select({
      reason: deductions.reason,
      total: sql<string>`sum(${deductions.amount})`,
      count: sql<number>`count(*)::int`,
      recovered: sql<string>`coalesce(sum(${deductions.recoveredAmount}), 0)`,
    })
    .from(deductions)
    .innerJoin(claims, eq(deductions.claimId, claims.id))
    .where(
      and(
        gte(deductions.createdAt, since),
        ...(until ? [lte(deductions.createdAt, until)] : []),
      ),
    )
    .groupBy(deductions.reason);
}

/**
 * This hospital's settled history for one insurer, optionally narrowed to
 * one procedure: how many claims it settled, and what each deduction reason
 * cost across them.
 */
export async function settledHistoryForScope(scope: {
  insurerId: string;
  /** Omit for insurer-wide history. */
  procedureId?: string | undefined;
  excludeClaimId: string;
}) {
  const inScope = and(
    eq(claims.insurerId, scope.insurerId),
    eq(claims.status, "SETTLED"),
    ne(claims.id, scope.excludeClaimId),
    ...(scope.procedureId ? [eq(claims.procedureId, scope.procedureId)] : []),
  );

  const [[denominator], byReason] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(inScope),
    db
      .select({
        reason: deductions.reason,
        // distinct: two line items cut for the same reason on one claim are
        // one claim that lost money that way, not two.
        claimsAffected: sql<number>`count(distinct ${deductions.claimId})::int`,
        total: sql<string>`sum(${deductions.amount})`,
        // What was clawed back on appeal (docs/adr/0013).
        recovered: sql<string>`coalesce(sum(${deductions.recoveredAmount}), 0)`,
      })
      .from(deductions)
      .innerJoin(claims, eq(deductions.claimId, claims.id))
      .where(inScope)
      .groupBy(deductions.reason),
  ]);

  return {
    claimsConsidered: denominator?.count ?? 0,
    byReason: byReason.map((row) => ({
      reason: row.reason,
      claimsAffected: row.claimsAffected,
      total: Number(row.total),
      recovered: Number(row.recovered),
    })),
  };
}

/** One claim's deducted and recovered totals. */
export async function totalsForClaim(claimId: string) {
  const [row] = await db
    .select({
      deducted: sql<string>`coalesce(sum(${deductions.amount}), 0)`,
      recovered: sql<string>`coalesce(sum(${deductions.recoveredAmount}), 0)`,
    })
    .from(deductions)
    .where(eq(deductions.claimId, claimId));

  return {
    deducted: Number(row?.deducted ?? 0),
    recovered: Number(row?.recovered ?? 0),
  };
}

export async function getById(id: string) {
  const [row] = await db.select().from(deductions).where(eq(deductions.id, id));
  return row;
}

/** Opens an appeal. Only ever called on a deduction nobody has contested yet. */
export async function contest(id: string, note: string | undefined) {
  const [row] = await db
    .update(deductions)
    .set({
      appealStatus: "CONTESTED",
      contestedAt: new Date(),
      ...(note ? { appealNote: note } : {}),
    })
    .where(eq(deductions.id, id))
    .returning();
  return row;
}

/** Records what the insurer gave back, and the outcome that follows from it. */
export async function resolveAppeal(
  id: string,
  outcome: DeductionAppealStatus,
  recoveredAmount: number,
  note: string | undefined,
) {
  const [row] = await db
    .update(deductions)
    .set({
      appealStatus: outcome,
      recoveredAmount: recoveredAmount.toString(),
      resolvedAt: new Date(),
      ...(note ? { appealNote: note } : {}),
    })
    .where(eq(deductions.id, id))
    .returning();
  return row;
}

/** Every deduction still worth chasing, newest first, across claims. */
export async function listAppealWorklist(filters: {
  status?: DeductionAppealStatus;
}) {
  const conditions = filters.status
    ? [eq(deductions.appealStatus, filters.status)]
    : [
        // Default: the two states a human can still act on.
        inArray(deductions.appealStatus, ["NOT_CONTESTED", "CONTESTED"]),
      ];

  return db
    .select({
      id: deductions.id,
      claimId: deductions.claimId,
      claimReference: claims.reference,
      patientName: claims.patientName,
      insurerName: insurers.name,
      reason: deductions.reason,
      amount: deductions.amount,
      appealStatus: deductions.appealStatus,
      recoveredAmount: deductions.recoveredAmount,
      contestedAt: deductions.contestedAt,
      resolvedAt: deductions.resolvedAt,
      appealNote: deductions.appealNote,
      createdAt: deductions.createdAt,
    })
    .from(deductions)
    .innerJoin(claims, eq(deductions.claimId, claims.id))
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .where(and(...conditions))
    .orderBy(desc(deductions.createdAt));
}
