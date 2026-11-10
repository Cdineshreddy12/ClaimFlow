import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  claims,
  doctorApprovals,
  hospitalProfile,
  insurers,
  procedures,
} from "../../db/schema.js";
import { getClaimById } from "../claims/claims.repository.js";

const LINK_EXPIRY_HOURS = 48;

export async function create(
  claimId: string,
  doctorName: string,
  requestedByMemberId: string | null,
) {
  // Org scoping comes through the claim, same as documents and queries.
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;

  const [approval] = await db
    .insert(doctorApprovals)
    .values({
      claimId,
      token: crypto.randomUUID(),
      doctorName,
      requestedBy: requestedByMemberId,
      expiresAt: new Date(Date.now() + LINK_EXPIRY_HOURS * 60 * 60 * 1000),
    })
    .returning();
  return approval;
}

export async function listForClaim(claimId: string) {
  const claim = await getClaimById(claimId);
  if (!claim) return undefined;
  return db
    .select()
    .from(doctorApprovals)
    .where(eq(doctorApprovals.claimId, claimId))
    .orderBy(desc(doctorApprovals.createdAt));
}

/**
 * Unauthenticated lookup — the token is the only credential, so this
 * returns just enough for the doctor to know what they're deciding on: the
 * patient, the procedure, the hospital asking.
 */
export async function getByTokenWithContext(token: string) {
  const [row] = await db
    .select({
      approval: doctorApprovals,
      claimId: claims.id,
      patientName: claims.patientName,
      procedureName: procedures.name,
      insurerName: insurers.name,
      hospitalName: hospitalProfile.name,
    })
    .from(doctorApprovals)
    .innerJoin(claims, eq(doctorApprovals.claimId, claims.id))
    // One hospital per install, so this is an unconditional join to the
    // only row — the doctor's page still has to name the hospital.
    .innerJoin(hospitalProfile, sql`true`)
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .where(eq(doctorApprovals.token, token));
  return row;
}

/** Stamped on first open only — later views don't overwrite when they first saw it. */
export async function markFirstViewed(id: string) {
  await db
    .update(doctorApprovals)
    .set({ firstViewedAt: new Date() })
    .where(eq(doctorApprovals.id, id));
}

export async function recordDecision(
  id: string,
  decision: { approved: true } | { approved: false; reason: string },
) {
  const [updated] = await db
    .update(doctorApprovals)
    .set(
      decision.approved
        ? { approvedAt: new Date() }
        : { declinedAt: new Date(), declineReason: decision.reason },
    )
    .where(eq(doctorApprovals.id, id))
    .returning();
  return updated;
}
