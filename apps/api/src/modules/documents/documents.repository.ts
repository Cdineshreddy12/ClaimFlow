import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { claims, documents } from "../../db/schema.js";

/**
 * Documents belong to a claim, which belongs to an organization — every
 * function here goes through the claim to inherit that scoping, same
 * boundary rule as claims.repository.ts (see docs/adr/0002).
 */

async function assertClaimInOrg(
  organizationId: string,
  claimId: string,
): Promise<boolean> {
  const [claim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(
      and(eq(claims.id, claimId), eq(claims.organizationId, organizationId)),
    );
  return Boolean(claim);
}

export async function listForClaim(organizationId: string, claimId: string) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  return db.select().from(documents).where(eq(documents.claimId, claimId));
}

export async function create(
  organizationId: string,
  claimId: string,
  data: { fileUrl: string },
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const [document] = await db
    .insert(documents)
    .values({ claimId, fileUrl: data.fileUrl })
    .returning();
  return document;
}

export async function getById(
  organizationId: string,
  claimId: string,
  documentId: string,
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.claimId, claimId)));
  return document;
}

export async function confirm(
  organizationId: string,
  claimId: string,
  documentId: string,
  checklistSlot: string,
  confirmedBy: string | null,
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const [updated] = await db
    .update(documents)
    .set({ checklistSlot, confirmedBy, confirmedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.claimId, claimId)))
    .returning();
  return updated;
}

export async function remove(
  organizationId: string,
  claimId: string,
  documentId: string,
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const [deleted] = await db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.claimId, claimId)))
    .returning();
  return deleted;
}

/** The checklist slots a claim already has a *confirmed* document for — the other half of the gap computation. */
export async function confirmedSlotsForClaim(
  claimId: string,
): Promise<string[]> {
  const rows = await db
    .select({ checklistSlot: documents.checklistSlot })
    .from(documents)
    .where(
      and(
        eq(documents.claimId, claimId),
        isNotNull(documents.checklistSlot),
        isNotNull(documents.confirmedAt),
      ),
    );
  return rows
    .map((r) => r.checklistSlot)
    .filter((slot): slot is string => slot !== null);
}
