import { sql } from "drizzle-orm";
import type { ClaimStatus } from "@claimflow/contracts";
import { db } from "../../db/client.js";

/**
 * Every open claim's current clock, read across the whole desk.
 *
 * `distinct on (claim_id)` rather than a correlated subquery: this is
 * "the latest status event per claim", which is exactly what distinct
 * on expresses, and Postgres answers it from the claim_id index in one
 * pass. The alternative reads the events table once per claim.
 *
 * Only non-terminal claims. A breach on a settled claim is history, and
 * history belongs in the turnaround report below, not in a worklist
 * that is supposed to be actionable this minute.
 */
export interface SlaWatchRow {
  claimId: string;
  reference: string;
  patientName: string;
  insurerName: string;
  status: ClaimStatus;
  enteredAt: Date;
  slaDeadline: Date | null;
}

export async function listOpenClaimClocks(): Promise<SlaWatchRow[]> {
  const rows = await db.execute<{
    claim_id: string;
    reference: string;
    patient_name: string;
    insurer_name: string;
    status: ClaimStatus;
    entered_at: Date;
    sla_deadline: Date | null;
  }>(sql`
    select distinct on (e.claim_id)
      e.claim_id,
      c.reference,
      c.patient_name,
      i.name as insurer_name,
      e.status,
      e.created_at as entered_at,
      e.sla_deadline
    from claim_status_events e
    join claims c on c.id = e.claim_id
    join insurers i on i.id = c.insurer_id
    where c.status not in ('SETTLED', 'REJECTED')
    order by e.claim_id, e.created_at desc
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    claimId: row.claim_id as string,
    reference: row.reference as string,
    patientName: row.patient_name as string,
    insurerName: row.insurer_name as string,
    status: row.status as ClaimStatus,
    enteredAt: new Date(row.entered_at as string),
    slaDeadline: row.sla_deadline ? new Date(row.sla_deadline as string) : null,
  }));
}

/**
 * How long each insurer actually took, per decision, over a window.
 *
 * Measured between consecutive status events: the clock starts when the
 * desk sends something and stops when the next status lands, which is
 * the only definition the desk can defend in a meeting with the TPA.
 * Claims still waiting are excluded rather than counted as fast —
 * an unanswered request has no duration yet, and treating it as zero
 * would flatter the insurer it's still waiting on.
 */
export interface TurnaroundRow {
  insurerName: string;
  fromStatus: ClaimStatus;
  decisions: number;
  avgHours: number;
  worstHours: number;
  breaches: number;
}

export async function insurerTurnaround(
  since: Date,
  until?: Date,
): Promise<TurnaroundRow[]> {
  const rows = await db.execute(sql`
    with ordered as (
      select
        e.claim_id,
        e.status,
        e.created_at,
        e.sla_deadline,
        lead(e.created_at) over (
          partition by e.claim_id order by e.created_at
        ) as answered_at
      from claim_status_events e
      -- An ISO string with an explicit cast, not a Date: a bound
      -- parameter goes through the postgres-js protocol, which has no
      -- encoder for a JS Date and throws at bind time.
      where e.created_at >= ${since.toISOString()}::timestamptz
      ${until ? sql`and e.created_at <= ${until.toISOString()}::timestamptz` : sql``}
    )
    select
      i.name as insurer_name,
      o.status as from_status,
      count(*)::int as decisions,
      avg(extract(epoch from (o.answered_at - o.created_at)) / 3600) as avg_hours,
      max(extract(epoch from (o.answered_at - o.created_at)) / 3600) as worst_hours,
      count(*) filter (
        where o.sla_deadline is not null and o.answered_at > o.sla_deadline
      )::int as breaches
    from ordered o
    join claims c on c.id = o.claim_id
    join insurers i on i.id = c.insurer_id
    where o.answered_at is not null
      and o.status in ('PRE_AUTH_SENT', 'FINAL_BILL_SUBMITTED', 'ENHANCEMENT_REQUESTED')
    group by i.name, o.status
    order by i.name, o.status
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    insurerName: row.insurer_name as string,
    fromStatus: row.from_status as ClaimStatus,
    decisions: Number(row.decisions),
    avgHours: Number(row.avg_hours),
    worstHours: Number(row.worst_hours),
    breaches: Number(row.breaches),
  }));
}
