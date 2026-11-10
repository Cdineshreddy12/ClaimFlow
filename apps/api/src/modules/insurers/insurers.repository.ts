import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { checklistRules, claims, insurers } from "../../db/schema.js";

/** The master list, each row carrying how much depends on it. */
export async function list(includeInactive: boolean) {
  const [rows, claimCounts, ruleCounts] = await Promise.all([
    db.select().from(insurers).orderBy(asc(insurers.name)),
    db
      .select({ insurerId: claims.insurerId, n: count() })
      .from(claims)
      .groupBy(claims.insurerId),
    db
      .select({ insurerId: checklistRules.insurerId, n: count() })
      .from(checklistRules)
      .groupBy(checklistRules.insurerId),
  ]);

  const claimsBy = new Map(claimCounts.map((r) => [r.insurerId, r.n]));
  const rulesBy = new Map(ruleCounts.map((r) => [r.insurerId, r.n]));

  return rows
    .filter((r) => includeInactive || r.isActive)
    .map((r) => ({
      ...r,
      claimCount: claimsBy.get(r.id) ?? 0,
      ruleCount: rulesBy.get(r.id) ?? 0,
    }));
}

export async function getById(id: string) {
  const [row] = await db.select().from(insurers).where(eq(insurers.id, id));
  return row;
}

/** Case-insensitive: "Company B" and "company b" are one organisation. */
export async function findByName(name: string, exceptId?: string) {
  const rows = await db
    .select({ id: insurers.id })
    .from(insurers)
    .where(sql`lower(${insurers.name}) = lower(${name})`);
  return rows.find((r) => r.id !== exceptId);
}

export interface InsurerFields {
  name: string;
  type: string;
  code?: string | null;
  contactEmail?: string | null;
}

export async function create(fields: InsurerFields) {
  const [row] = await db
    .insert(insurers)
    .values({
      name: fields.name,
      type: fields.type,
      code: fields.code ?? null,
      contactEmail: fields.contactEmail ?? null,
    })
    .returning();
  return row;
}

export async function update(id: string, fields: InsurerFields) {
  const [row] = await db
    .update(insurers)
    .set({
      name: fields.name,
      type: fields.type,
      code: fields.code ?? null,
      contactEmail: fields.contactEmail ?? null,
      updatedAt: new Date(),
    })
    .where(eq(insurers.id, id))
    .returning();
  return row;
}

export async function setActive(id: string, isActive: boolean) {
  const [row] = await db
    .update(insurers)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(insurers.id, id))
    .returning();
  return row;
}

/** Nothing may be deleted once a claim was filed against it. */
export async function usageCount(id: string): Promise<number> {
  const [claimRow] = await db
    .select({ n: count() })
    .from(claims)
    .where(eq(claims.insurerId, id));
  const [ruleRow] = await db
    .select({ n: count() })
    .from(checklistRules)
    .where(eq(checklistRules.insurerId, id));
  return (claimRow?.n ?? 0) + (ruleRow?.n ?? 0);
}

export async function remove(id: string) {
  const [row] = await db
    .delete(insurers)
    .where(eq(insurers.id, id))
    .returning();
  return row;
}
