import { and, count, eq, notInArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { checklistRules, claims } from "../../db/schema.js";
import type {
  CreateChecklistRuleBody,
  UpdateChecklistRuleBody,
} from "./checklist.schema.js";

/** Every function here is org-scoped — same rule as claims.repository.ts, see docs/adr/0002. */

export async function listRules(insurerId: string, procedureId: string) {
  return db
    .select()
    .from(checklistRules)
    .where(
      and(
        eq(checklistRules.insurerId, insurerId),
        eq(checklistRules.procedureId, procedureId),
      ),
    );
}

export async function createRule(data: CreateChecklistRuleBody) {
  const [rule] = await db
    .insert(checklistRules)
    .values({
      insurerId: data.insurerId,
      procedureId: data.procedureId,
      documentType: data.documentType,
      required: data.required,
    })
    .returning();
  // We just inserted exactly one row — this is never actually absent.
  return rule!;
}

export async function updateRule(id: string, data: UpdateChecklistRuleBody) {
  const patch: Partial<typeof checklistRules.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.documentType !== undefined) patch.documentType = data.documentType;
  if (data.required !== undefined) patch.required = data.required;

  const [updated] = await db
    .update(checklistRules)
    .set(patch)
    .where(and(eq(checklistRules.id, id)))
    .returning();
  return updated;
}

export async function deleteRule(id: string) {
  const [deleted] = await db
    .delete(checklistRules)
    .where(and(eq(checklistRules.id, id)))
    // Full row, not just the id — the audit trail records what the rule
    // *was* before it was removed, which is the only place that's still
    // knowable after this returns.
    .returning();
  return deleted;
}

/**
 * Claims still being worked (not SETTLED/REJECTED) against this insurer +
 * procedure — backs the "N active claims" notice the checklist admin
 * screen shows, per docs/adr/0001's versioning rule: editing a rule only
 * affects claims opened after the edit, so this is informational, not a
 * block on saving.
 */
export async function countActiveClaimsFor(
  insurerId: string,
  procedureId: string,
) {
  const [result] = await db
    .select({ value: count() })
    .from(claims)
    .where(
      and(
        eq(claims.insurerId, insurerId),
        eq(claims.procedureId, procedureId),
        notInArray(claims.status, ["SETTLED", "REJECTED"]),
      ),
    );
  return result?.value ?? 0;
}
