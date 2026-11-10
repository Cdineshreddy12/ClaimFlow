import { and, count, eq, notInArray, sql } from "drizzle-orm";
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
 * procedure — backs the "N active claims" notice the checklist admin screen
 * shows, per docs/adr/0001's versioning rule: editing a rule only affects
 * claims opened after the edit, so this is informational, not a block on
 * saving.
 */
/**
 * Every insurer × procedure pair the desk has actually opened a claim on,
 * with how many rules that pair has.
 */
export interface CoverageRow {
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  rules: number;
  claims: number;
  activeClaims: number;
  lastClaimAt: Date | null;
}

export async function listCoverage(): Promise<CoverageRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      i.id   as insurer_id,
      i.name as insurer_name,
      p.id   as procedure_id,
      p.name as procedure_name,
      count(c.id) as claims,
      count(c.id) filter (
        where c.status not in ('SETTLED', 'REJECTED')
      ) as active_claims,
      max(c.created_at) as last_claim_at,
      (
        select count(*)
        from checklist_rules r
        where r.insurer_id = i.id and r.procedure_id = p.id
      ) as rules
    from claims c
    join insurers i on i.id = c.insurer_id
    join procedures p on p.id = c.procedure_id
    group by i.id, i.name, p.id, p.name
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    insurerId: row.insurer_id as string,
    insurerName: row.insurer_name as string,
    procedureId: row.procedure_id as string,
    procedureName: row.procedure_name as string,
    rules: Number(row.rules),
    claims: Number(row.claims),
    activeClaims: Number(row.active_claims),
    lastClaimAt: row.last_claim_at
      ? new Date(row.last_claim_at as string)
      : null,
  }));
}

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

/** Every rule, for the proposal pass. */
export async function listAllRules() {
  return db.select().from(checklistRules);
}

/**
 * What TPAs have actually asked for, per (insurer, procedure), against how
 * many claims were submitted to them.
 */
export interface RequestedItemRow {
  insurerId: string;
  insurerName: string;
  procedureId: string;
  procedureName: string;
  requestedItem: string;
  claimsRequested: number;
  claimsSubmitted: number;
}

export async function requestedItemsByPair(): Promise<RequestedItemRow[]> {
  const rows = await db.execute(sql`
    with submitted as (
      select c.insurer_id, c.procedure_id, count(*)::int as claims_submitted
      from claims c
      where c.status <> 'DRAFT'
      group by c.insurer_id, c.procedure_id
    ),
    requested as (
      select
        c.insurer_id,
        c.procedure_id,
        item.value as requested_item,
        count(distinct q.claim_id)::int as claims_requested
      from queries q
      join claims c on c.id = q.claim_id
      cross join lateral jsonb_array_elements_text(q.requested_items) as item(value)
      where c.status <> 'DRAFT'
        and length(trim(item.value)) > 1
      group by c.insurer_id, c.procedure_id, item.value
    )
    select
      i.id as insurer_id,
      i.name as insurer_name,
      p.id as procedure_id,
      p.name as procedure_name,
      r.requested_item,
      r.claims_requested,
      s.claims_submitted
    from requested r
    join submitted s
      on s.insurer_id = r.insurer_id and s.procedure_id = r.procedure_id
    join insurers i on i.id = r.insurer_id
    join procedures p on p.id = r.procedure_id
    order by r.claims_requested desc
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    insurerId: row.insurer_id as string,
    insurerName: row.insurer_name as string,
    procedureId: row.procedure_id as string,
    procedureName: row.procedure_name as string,
    requestedItem: row.requested_item as string,
    claimsRequested: Number(row.claims_requested),
    claimsSubmitted: Number(row.claims_submitted),
  }));
}
