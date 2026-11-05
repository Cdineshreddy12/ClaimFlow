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

/**
 * Totals per reason for the dashboard. Aggregated in Postgres rather
 * than by pulling every row into the API — a desk doing ~650 admissions
 * a month accumulates deductions fast, and this runs on every dashboard
 * load.
 *
 * `until` is optional and open-ended by default, which is what the
 * dashboard wants ("this month so far"). A closed period report (last
 * month, in full) passes it to stop today's deductions leaking into a
 * report about a month that already ended.
 */
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
 * This hospital's settled history for one insurer, optionally narrowed
 * to one procedure: how many claims it settled, and what each deduction
 * reason cost across them.
 *
 * `SETTLED` only, and that is the whole denominator question. A claim
 * still in flight hasn't had the chance to lose money yet, so counting
 * it would quietly deflate every rate; a `REJECTED` one lost all of it
 * for reasons a deduction row doesn't describe. Either would make the
 * percentages read lower than the truth, which is the one direction a
 * warning must never err in.
 *
 * The current claim is excluded by id: a claim can't be evidence about
 * itself, and on a re-settled claim it would be.
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
        // distinct: two line items cut for the same reason on one claim
        // are one claim that lost money that way, not two. Counting rows
        // here would report a rate above 100% on a bad month.
        claimsAffected: sql<number>`count(distinct ${deductions.claimId})::int`,
        total: sql<string>`sum(${deductions.amount})`,
        // What was clawed back on appeal. A reason the hospital reliably
        // wins back is a smaller risk than its gross total suggests —
        // see docs/adr/0013.
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

/**
 * One claim's deducted and recovered totals.
 *
 * Separate from `sumByReasonSince` because that one answers "what did
 * this month cost the hospital" and this one answers "where did this
 * claim end up" — the first is grouped and time-boxed, the second is a
 * pair of numbers for a single claim's financial line.
 */
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

/**
 * Records what the insurer gave back, and the outcome that follows from
 * it. The outcome is derived from the money by the caller rather than
 * chosen, so "recovered in full" can never sit next to a partial
 * amount.
 */
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

/**
 * Every deduction still worth chasing, newest first, across claims.
 *
 * Read across the whole desk rather than within one claim — an appeal
 * worklist is a different question from "what happened to this claim",
 * and it's the question that gets money back. Joins the claim's
 * reference and patient so the list is readable without N more queries.
 */
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
