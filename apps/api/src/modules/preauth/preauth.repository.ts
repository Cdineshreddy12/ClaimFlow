import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { claimPreauthFields, claims } from "../../db/schema.js";

/**
 * Pre-auth fields hang off a claim, which belongs to an organization —
 * every function goes through the claim to inherit that scoping, same
 * boundary rule as documents.repository.ts (docs/adr/0002).
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
  return db
    .select()
    .from(claimPreauthFields)
    .where(eq(claimPreauthFields.claimId, claimId));
}

export interface SuggestionRow {
  fieldKey: string;
  aiValue: string;
  confidence: number;
  sourceSnippet: string;
  sourceDocumentId: string | null;
  extractedBy: string;
}

/**
 * Writes suggestions without touching `value`, `confirmedAt` or
 * `confirmedBy` — re-running the extractor must never quietly replace a
 * figure a human already stood behind (docs/adr/0005). The conflict
 * clause is what enforces that: it updates the suggestion columns only.
 */
export async function saveSuggestions(
  claimId: string,
  rows: SuggestionRow[],
  extractedAt: Date,
) {
  if (rows.length === 0) return [];
  return db
    .insert(claimPreauthFields)
    .values(
      rows.map((row) => ({
        claimId,
        fieldKey: row.fieldKey,
        aiValue: row.aiValue,
        confidence: row.confidence.toFixed(3),
        sourceSnippet: row.sourceSnippet,
        sourceDocumentId: row.sourceDocumentId,
        extractedBy: row.extractedBy,
        extractedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [claimPreauthFields.claimId, claimPreauthFields.fieldKey],
      set: {
        aiValue: sql`excluded.ai_value`,
        confidence: sql`excluded.confidence`,
        sourceSnippet: sql`excluded.source_snippet`,
        sourceDocumentId: sql`excluded.source_document_id`,
        extractedBy: sql`excluded.extracted_by`,
        extractedAt: sql`excluded.extracted_at`,
        updatedAt: new Date(),
      },
    })
    .returning();
}

/**
 * The human-confirm step. Sets the value a human stands behind and
 * stamps who did it; the suggestion columns stay exactly as they were so
 * the audit trail can still show what the model proposed.
 */
export async function confirm(
  organizationId: string,
  claimId: string,
  fieldKey: string,
  value: string,
  confirmedBy: string | null,
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const now = new Date();
  const [row] = await db
    .insert(claimPreauthFields)
    .values({
      claimId,
      fieldKey,
      value,
      confirmedBy,
      confirmedAt: now,
    })
    .onConflictDoUpdate({
      target: [claimPreauthFields.claimId, claimPreauthFields.fieldKey],
      set: { value, confirmedBy, confirmedAt: now, updatedAt: now },
    })
    .returning();
  return row;
}

/**
 * Clears the human value, leaving any suggestion in place so the field
 * goes back to needing a decision rather than disappearing.
 */
export async function clearValue(
  organizationId: string,
  claimId: string,
  fieldKey: string,
) {
  if (!(await assertClaimInOrg(organizationId, claimId))) return undefined;
  const [row] = await db
    .update(claimPreauthFields)
    .set({
      value: null,
      confirmedBy: null,
      confirmedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(claimPreauthFields.claimId, claimId),
        eq(claimPreauthFields.fieldKey, fieldKey),
      ),
    )
    .returning();
  return row;
}
