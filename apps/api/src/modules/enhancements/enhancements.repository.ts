import { and, desc, eq, sql } from "drizzle-orm";
import type { EnhancementStatus } from "@claimflow/contracts";
import { db } from "../../db/client.js";
import { claims, enhancements } from "../../db/schema.js";
import { getClaimById } from "../claims/claims.repository.js";

export async function listForClaim(claimId: string) {
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;
  return db
    .select()
    .from(enhancements)
    .where(eq(enhancements.claimId, claimId))
    .orderBy(desc(enhancements.createdAt));
}

export async function getById(id: string) {
  const [row] = await db
    .select()
    .from(enhancements)
    .where(eq(enhancements.id, id));
  return row;
}

/** The one awaiting an answer, if any. At most one is open at a time — enforced in the service. */
export async function getOpenForClaim(claimId: string) {
  const [row] = await db
    .select()
    .from(enhancements)
    .where(
      and(
        eq(enhancements.claimId, claimId),
        eq(enhancements.status, "REQUESTED"),
      ),
    );
  return row;
}

export async function create(
  claimId: string,
  data: {
    requestedAmount: number;
    reason: string;
    slaDeadline: Date | null;
  },
  requestedBy: string | null,
) {
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;

  const [row] = await db
    .insert(enhancements)
    .values({
      claimId,
      requestedAmount: data.requestedAmount.toString(),
      reason: data.reason,
      slaDeadline: data.slaDeadline,
      requestedBy,
    })
    .returning();
  return row;
}

/**
 * Records the insurer's answer and, on an approval, raises the claim's
 * sanctioned amount by what was granted — in one transaction.
 *
 * The two writes cannot be allowed to drift: a claim whose sanctioned
 * amount doesn't include an approved enhancement understates its own
 * ceiling, which is exactly the hole docs/adr/0012 exists to close.
 */
export async function decide(
  id: string,
  outcome: EnhancementStatus,
  approvedAmount: number | undefined,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(enhancements)
      .where(eq(enhancements.id, id));
    if (!existing) return undefined;

    const [updated] = await tx
      .update(enhancements)
      .set({
        status: outcome,
        approvedAmount:
          approvedAmount === undefined ? null : approvedAmount.toString(),
        decidedAt: new Date(),
      })
      .where(eq(enhancements.id, id))
      .returning();

    if (approvedAmount !== undefined && approvedAmount > 0) {
      // coalesce: the first enhancement on a claim whose sanctioned
      // amount was never recorded still has to produce a ceiling, and
      // null + anything would have silently stayed null.
      await tx
        .update(claims)
        .set({
          sanctionedAmount: sql`coalesce(${claims.sanctionedAmount}, 0) + ${approvedAmount.toString()}`,
          updatedAt: new Date(),
        })
        .where(eq(claims.id, existing.claimId));
    }

    return updated;
  });
}

/** Sum of everything granted on a claim — the part of the ceiling that came from enhancements. */
export async function approvedTotalForClaim(claimId: string) {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${enhancements.approvedAmount}), 0)`,
    })
    .from(enhancements)
    .where(eq(enhancements.claimId, claimId));
  return Number(row?.total ?? 0);
}
