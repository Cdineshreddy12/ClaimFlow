import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { checklistRules, claims, procedures } from "../../db/schema.js";

/**
 * The procedure master, with the two counts that decide what a desk is
 * allowed to do to a row.
 *
 * Same shape as the insurer master next door: a procedure with claims
 * filed against it can never be deleted without those claims losing
 * the name they were opened under.
 */
export async function list() {
  /*
    Two grouped queries, not correlated subqueries in the select.

    The insurer master next door carries a comment warning about
    exactly this and I wrote the broken version anyway: the subquery
    form silently returns 0 for every row, which would show "0 claims"
    beside a procedure that has them and invite somebody to delete one
    the desk is actively filing against.
  */
  const [rows, claimCounts, ruleCounts] = await Promise.all([
    db.select().from(procedures).orderBy(asc(procedures.name)),
    db
      .select({ procedureId: claims.procedureId, n: count() })
      .from(claims)
      .groupBy(claims.procedureId),
    db
      .select({ procedureId: checklistRules.procedureId, n: count() })
      .from(checklistRules)
      .groupBy(checklistRules.procedureId),
  ]);

  const claimsBy = new Map(claimCounts.map((r) => [r.procedureId, r.n]));
  const rulesBy = new Map(ruleCounts.map((r) => [r.procedureId, r.n]));

  return rows.map((r) => ({
    ...r,
    claims: claimsBy.get(r.id) ?? 0,
    rules: rulesBy.get(r.id) ?? 0,
  }));
}

export async function getById(id: string) {
  const [row] = await db
    .select()
    .from(procedures)
    .where(eq(procedures.id, id))
    .limit(1);
  return row;
}

/** Case-insensitive: "Gall bladder removal" and "gall bladder removal" are one procedure. */
export async function findByName(name: string, excludeId?: string) {
  const [row] = await db
    .select({ id: procedures.id })
    .from(procedures)
    .where(
      excludeId
        ? and(
            sql`lower(${procedures.name}) = lower(${name})`,
            ne(procedures.id, excludeId),
          )
        : sql`lower(${procedures.name}) = lower(${name})`,
    )
    .limit(1);
  return row;
}

export async function create(fields: { name: string; code: string | null }) {
  const [row] = await db.insert(procedures).values(fields).returning();
  return row;
}

export async function update(
  id: string,
  fields: { name: string; code: string | null },
) {
  const [row] = await db
    .update(procedures)
    .set(fields)
    .where(eq(procedures.id, id))
    .returning();
  return row;
}

/** How much depends on it — the answer to "can this be deleted". */
export async function usage(id: string) {
  const [claimRows, ruleRows] = await Promise.all([
    db.select({ n: count() }).from(claims).where(eq(claims.procedureId, id)),
    db
      .select({ n: count() })
      .from(checklistRules)
      .where(eq(checklistRules.procedureId, id)),
  ]);
  return {
    claims: Number(claimRows[0]?.n ?? 0),
    rules: Number(ruleRows[0]?.n ?? 0),
  };
}

export async function remove(id: string) {
  const [row] = await db
    .delete(procedures)
    .where(eq(procedures.id, id))
    .returning();
  return row;
}
