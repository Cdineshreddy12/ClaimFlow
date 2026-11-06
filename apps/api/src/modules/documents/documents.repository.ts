import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { claims, documents } from "../../db/schema.js";

/**
 * Documents belong to a claim, which belongs to an organization — every
 * function here goes through the claim to inherit that scoping, same
 * boundary rule as claims.repository.ts (see docs/adr/0002).
 */

/**
 * A claim has to exist before anything can hang off it. This used to
 * also prove the claim belonged to the caller's organization; with one
 * hospital per install there is nothing left to prove but existence.
 */
async function claimExists(claimId: string): Promise<boolean> {
  const [claim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.id, claimId));
  return Boolean(claim);
}

export async function listForClaim(claimId: string) {
  if (!(await claimExists(claimId))) return undefined;
  return db.select().from(documents).where(eq(documents.claimId, claimId));
}

export async function create(claimId: string, data: { fileUrl: string }) {
  if (!(await claimExists(claimId))) return undefined;
  const [document] = await db
    .insert(documents)
    .values({ claimId, fileUrl: data.fileUrl })
    .returning();
  return document;
}

/**
 * Stores a suggestion. Deliberately never touches `checklistSlot` or
 * `confirmedAt` — a classifier proposes, a human files (docs/adr/0005).
 */
export async function saveClassification(
  documentId: string,
  classification: {
    slot: string | null;
    confidence: number;
    reason: string;
    classifiedBy: string;
  },
) {
  const [updated] = await db
    .update(documents)
    .set({
      aiClassifiedType: classification.slot,
      confidence: classification.confidence.toFixed(3),
      classificationReason: classification.reason,
      classifiedBy: classification.classifiedBy,
      // Stamped on every write, so a re-read clears the "this predates
      // the current checklist" flag that prompted it.
      classifiedAt: new Date(),
    })
    .where(eq(documents.id, documentId))
    .returning();
  return updated;
}

export async function getById(claimId: string, documentId: string) {
  if (!(await claimExists(claimId))) return undefined;
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.claimId, claimId)));
  return document;
}

export async function confirm(
  claimId: string,
  documentId: string,
  checklistSlot: string,
  confirmedBy: string | null,
) {
  if (!(await claimExists(claimId))) return undefined;
  const [updated] = await db
    .update(documents)
    .set({ checklistSlot, confirmedBy, confirmedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.claimId, claimId)))
    .returning();
  return updated;
}

export async function remove(claimId: string, documentId: string) {
  if (!(await claimExists(claimId))) return undefined;
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
