import {
  and,
  eq,
  getTableColumns,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  CLAIM_STATUS_ORDER,
  type ClaimPage,
  type ClaimSortKey,
  type ClaimStatus,
  type SortDirection,
} from "@claimflow/contracts";
import { db } from "../../db/client.js";
import {
  claimStatusEvents,
  claims,
  insurers,
  procedures,
} from "../../db/schema.js";
import type {
  ChecklistSnapshotItem,
  CreateClaimBody,
} from "./claims.schema.js";

/**
 * One hospital per install, so there is no tenant predicate here any more
 * (docs/adr/0002).
 */

/** One page of claims, filtered, searched and sorted in the database. */
export async function listClaims(filters: {
  status?: ClaimStatus;
  assignedTo?: string | null;
  statuses?: ClaimStatus[] | null;
  q?: string | undefined;
  sort?: ClaimSortKey | undefined;
  dir?: SortDirection | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<ClaimPage<Awaited<ReturnType<typeof selectClaims>>[number]>> {
  const conditions = [];
  if (filters.status) conditions.push(eq(claims.status, filters.status));
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(claims.status, filters.statuses));
  }
  if (filters.assignedTo)
    conditions.push(eq(claims.assignedTo, filters.assignedTo));

  const q = filters.q?.trim();
  if (q) {
    // The four things a desk reads off a TPA email.
    const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(claims.patientName, like),
        ilike(claims.reference, like),
        ilike(insurers.name, like),
        ilike(procedures.name, like),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, counted] = await Promise.all([
    selectClaims(where, filters),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(claims)
      .innerJoin(insurers, eq(claims.insurerId, insurers.id))
      .innerJoin(procedures, eq(claims.procedureId, procedures.id))
      .where(where),
  ]);

  return { rows, total: Number(counted[0]?.total ?? 0) };
}

/** The ORDER BY, mirroring the comparators the list used to run in the browser. */
function orderFor(sort: ClaimSortKey | undefined, dir: SortDirection) {
  const desc = dir === "desc";
  const d = (col: SQL | PgColumn) =>
    desc ? sql`${col} desc` : sql`${col} asc`;
  switch (sort) {
    case "patient":
      return d(claims.patientName);
    case "insurer":
      return d(insurers.name);
    case "status":
      // Lifecycle order, not alphabetical — the same table the UI uses.
      return d(
        sql`case ${claims.status} ${sql.join(
          Object.entries(CLAIM_STATUS_ORDER).map(
            ([status, rank]) => sql`when ${status} then ${rank}`,
          ),
          sql` `,
        )} end`,
      );
    case "amount":
      // A claim with no amount yet sorts last either way rather than
      // counting as zero, which would bury it under settled rupees.
      return desc
        ? sql`${claims.billedAmount} desc nulls last`
        : sql`${claims.billedAmount} asc nulls last`;
    case "stageTime":
    default:
      // Oldest updatedAt = longest in stage. Descending by waiting time
      // is ascending by timestamp, so this is inverted deliberately.
      return desc
        ? sql`${claims.updatedAt} asc`
        : sql`${claims.updatedAt} desc`;
  }
}

/**
 * The clock the claim is currently on, from its latest status event
 * (docs/adr/0014).
 */
const latestSlaDeadline = sql<string | null>`(
  select e.sla_deadline
  from claim_status_events e
  where e.claim_id = ${claims.id}
  order by e.created_at desc
  limit 1
)`;

function selectClaims(
  where: SQL | undefined,
  filters: {
    sort?: ClaimSortKey | undefined;
    dir?: SortDirection | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  },
) {
  const query = db
    .select({
      ...getTableColumns(claims),
      insurerName: insurers.name,
      procedureName: procedures.name,
      slaDeadline: latestSlaDeadline,
    })
    .from(claims)
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(where)
    // A stable tiebreak, or two claims updated in the same millisecond
    // can swap between pages and one of them is never seen.
    .orderBy(orderFor(filters.sort, filters.dir ?? "desc"), sql`${claims.id}`);

  if (filters.limit === undefined) return query;
  return query.limit(filters.limit).offset(filters.offset ?? 0);
}

/** Joins insurer/procedure names on — anything rendering a single claim needs a name, not a bare id. */
export async function getClaimById(id: string) {
  const [claim] = await db
    .select({
      ...getTableColumns(claims),
      insurerName: insurers.name,
      procedureName: procedures.name,
      slaDeadline: latestSlaDeadline,
    })
    .from(claims)
    .innerJoin(insurers, eq(claims.insurerId, insurers.id))
    .innerJoin(procedures, eq(claims.procedureId, procedures.id))
    .where(eq(claims.id, id));
  return claim;
}

/**
 * The stage a query interrupted, or null if the claim has never been
 * queried.
 */
export async function statusBeforeQuery(
  claimId: string,
): Promise<ClaimStatus | null> {
  const rows = await db.execute(sql`
    select e.status
    from claim_status_events e
    where e.claim_id = ${claimId}
      and e.created_at < (
        select max(q.created_at) from claim_status_events q
        where q.claim_id = ${claimId} and q.status = 'QUERY_RAISED'
      )
    order by e.created_at desc
    limit 1
  `);
  const [row] = rows as unknown as { status: ClaimStatus }[];
  return row?.status ?? null;
}

export async function createClaim(
  data: CreateClaimBody & { sanctionedAmount?: number },
  checklistSnapshot: ChecklistSnapshotItem[],
  preauthLayoutSnapshot?: unknown,
) {
  const [claim] = await db
    .insert(claims)
    .values({
      patientName: data.patientName,
      insurerId: data.insurerId,
      procedureId: data.procedureId,
      // Always null on a new claim: nothing has been billed until the bill
      // is raised at discharge.
      billedAmount: null,
      admittedAt: data.admittedAt ?? null,
      // Government scheme claims only — the service refuses these on
      // any other payer. Both or neither, enforced in the database too.
      packageCode: data.packageCode ?? null,
      packageRate:
        data.packageRate !== undefined ? data.packageRate.toString() : null,
      sanctionedAmount:
        data.sanctionedAmount !== undefined
          ? data.sanctionedAmount.toString()
          : null,
      checklistSnapshot,
      ...(preauthLayoutSnapshot !== undefined ? { preauthLayoutSnapshot } : {}),
    })
    .returning();
  // We just inserted exactly one row — this is never actually absent.

  // The claim's own starting gun (docs/adr/0004).
  await db.insert(claimStatusEvents).values({
    claimId: claim!.id,
    status: "DRAFT",
    actorId: null,
    slaDeadline: null,
  });

  return claim!;
}

/**
 * Writes back the two facts the claim header and the dashboard already read
 * off columns, once a human has confirmed them on the pre-auth form.
 */
export async function updateConfirmedFacts(
  claimId: string,
  facts: {
    admittedAt?: Date;
    billedAmount?: string;
    /** What the insurer authorised — see docs/adr/0012. */
    sanctionedAmount?: string;
  },
) {
  if (
    facts.admittedAt === undefined &&
    facts.billedAmount === undefined &&
    facts.sanctionedAmount === undefined
  ) {
    return undefined;
  }
  const [updated] = await db
    .update(claims)
    .set({
      ...(facts.admittedAt !== undefined
        ? { admittedAt: facts.admittedAt }
        : {}),
      ...(facts.billedAmount !== undefined
        ? { billedAmount: facts.billedAmount }
        : {}),
      ...(facts.sanctionedAmount !== undefined
        ? { sanctionedAmount: facts.sanctionedAmount }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Appends one slot to a single claim's checklist snapshot.
 *
 * Concatenated in SQL rather than read-modify-written: two documents
 * filed into new slots at the same moment would otherwise race.
 */
export async function addChecklistSlot(
  claimId: string,
  item: ChecklistSnapshotItem,
) {
  const [updated] = await db
    .update(claims)
    .set({
      checklistSnapshot: sql`${claims.checklistSnapshot} || ${JSON.stringify([item])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/** Takes one slot back off a single claim's snapshot. */
export async function removeChecklistSlot(
  claimId: string,
  documentType: string,
) {
  const [updated] = await db
    .update(claims)
    .set({
      checklistSnapshot: sql`(
        select coalesce(jsonb_agg(item), '[]'::jsonb)
        from jsonb_array_elements(${claims.checklistSnapshot}) item
        where item->>'documentType' <> ${documentType}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/** Records what the insurer actually paid, and when. */
export async function recordPayment(
  claimId: string,
  settledAmount: string,
  settledOn: string,
) {
  const [updated] = await db
    .update(claims)
    .set({ settledAmount, settledOn, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Points a claim at a desk member, or back at nobody.
 *
 * Deliberately does not touch `updatedAt`: that is what the list's "time
 * in stage" measures from, and handing a claim to a colleague does not
 * restart the clock the insurer is judged by.
 */
export async function assign(claimId: string, assigneeId: string | null) {
  const [updated] = await db
    .update(claims)
    .set({ assignedTo: assigneeId })
    .where(eq(claims.id, claimId))
    .returning();
  return updated;
}

/**
 * Moves a claim on and records the event, atomically and only if it is
 * still at `expectedStatus` — the status the caller validated against.
 */
export async function recordStatusChange(
  claimId: string,
  status: ClaimStatus,
  actorId: string | null,
  slaDeadline: Date | undefined,
  expectedStatus: ClaimStatus,
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(claims)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(claims.id, claimId), eq(claims.status, expectedStatus)))
      .returning();

    if (!updated) return undefined;

    await tx.insert(claimStatusEvents).values({
      claimId,
      status,
      actorId,
      slaDeadline: slaDeadline ?? null,
    });

    return updated;
  });
}

/** Every number the dashboard shows, counted in one round trip. */
export async function claimOverview(opts: {
  assignedTo?: string | undefined;
  monthStart: Date;
  trendStart: Date;
  needsAttention: ClaimStatus[];
  openStatuses: ClaimStatus[];
  waitingLimit: number;
}) {
  const mine = opts.assignedTo
    ? eq(claims.assignedTo, opts.assignedTo)
    : undefined;
  const openOnly = and(inArray(claims.status, opts.openStatuses), mine);

  const [totals, byStatus, trend, waiting] = await Promise.all([
    db
      .select({
        openClaims: sql<number>`count(*)::int`,
        // Averaged in SQL rather than by sending every updatedAt over
        // the wire for the browser to subtract.
        avgStageHours: sql<
          number | null
        >`avg(extract(epoch from (now() - ${claims.updatedAt})) / 3600)`,
      })
      .from(claims)
      .where(openOnly),

    db
      .select({ status: claims.status, count: sql<number>`count(*)::int` })
      .from(claims)
      .where(mine)
      .groupBy(claims.status),

    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${claims.settledOn}), 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${claims.settledAmount}), 0)`,
      })
      .from(claims)
      .where(
        and(
          sql`${claims.settledOn} is not null`,
          sql`${claims.settledOn} >= ${opts.trendStart.toISOString().slice(0, 10)}::date`,
          mine,
        ),
      )
      .groupBy(sql`date_trunc('month', ${claims.settledOn})`),

    db
      .select({
        id: claims.id,
        reference: claims.reference,
        patientName: claims.patientName,
        status: claims.status,
        updatedAt: claims.updatedAt,
        insurerName: insurers.name,
        procedureName: procedures.name,
      })
      .from(claims)
      .innerJoin(insurers, eq(claims.insurerId, insurers.id))
      .innerJoin(procedures, eq(claims.procedureId, procedures.id))
      .where(and(inArray(claims.status, opts.needsAttention), mine))
      // Longest-waiting first: the top of this list is the thing most
      // at risk, and only the top of it is ever read.
      .orderBy(sql`${claims.updatedAt} asc`)
      .limit(opts.waitingLimit),
  ]);

  const settled = await db
    .select({
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${claims.settledAmount}), 0)`,
    })
    .from(claims)
    .where(
      and(
        sql`${claims.settledOn} >= ${opts.monthStart.toISOString().slice(0, 10)}::date`,
        mine,
      ),
    );

  return {
    openClaims: Number(totals[0]?.openClaims ?? 0),
    avgStageHours:
      totals[0]?.avgStageHours == null ? null : Number(totals[0].avgStageHours),
    byStatus: byStatus.map((r) => ({
      status: r.status as ClaimStatus,
      count: Number(r.count),
    })),
    trend: trend.map((r) => ({
      month: r.month,
      count: Number(r.count),
      value: Number(r.value),
    })),
    settledThisMonth: {
      count: Number(settled[0]?.count ?? 0),
      value: Number(settled[0]?.value ?? 0),
    },
    waiting,
  };
}
