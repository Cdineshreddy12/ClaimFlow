import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";

/**
 * Claims the hospital has billed for and not been paid for.
 *
 * The clock starts at the **final bill**, not at admission or claim
 * creation. Before the bill goes in there is nothing owed — a claim in
 * pre-auth is work in progress, and ageing it as a receivable would
 * put the hospital's own turnaround into a number meant to measure the
 * insurer's.
 *
 * `distinct on` takes the most recent FINAL_BILL_SUBMITTED event,
 * because a claim can go back to query and be re-submitted; the clock
 * that matters is the one running now.
 */

export interface OutstandingClaimRow {
  claimId: string;
  reference: string | null;
  patientName: string;
  insurerName: string;
  status: string;
  billedAt: Date;
  /** What the insurer committed to, less anything already paid. */
  outstanding: number;
}

export async function listOutstanding(
  now = new Date(),
): Promise<OutstandingClaimRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with billed as (
      select distinct on (e.claim_id)
        e.claim_id,
        e.created_at as billed_at
      from claim_status_events e
      where e.status = 'FINAL_BILL_SUBMITTED'
      order by e.claim_id, e.created_at desc
    )
    select
      c.id as claim_id,
      c.reference,
      c.patient_name,
      c.status,
      i.name as insurer_name,
      b.billed_at,
      -- Sanctioned is what the insurer actually committed to; billed is
      -- the fallback while they have not said. Anything already paid
      -- comes off, so a part-settled claim ages only on its remainder.
      coalesce(c.sanctioned_amount, c.billed_amount, 0)
        - coalesce(c.settled_amount, 0) as outstanding
    from claims c
    join billed b on b.claim_id = c.id
    join insurers i on i.id = c.insurer_id
    where c.status not in ('SETTLED', 'REJECTED')
      -- ISO string, not the Date: postgres.js does not serialise a
      -- Date reaching it through a raw sql template, and fails at bind
      -- time with an unhelpful ERR_INVALID_ARG_TYPE.
      and b.billed_at <= ${now.toISOString()}
  `);

  return (
    (rows as unknown as Record<string, unknown>[])
      .map((row) => ({
        claimId: row.claim_id as string,
        reference: (row.reference as string | null) ?? null,
        patientName: row.patient_name as string,
        insurerName: row.insurer_name as string,
        status: row.status as string,
        billedAt: new Date(row.billed_at as string),
        outstanding: Number(row.outstanding),
      }))
      // A claim billed at zero, or already paid in full while its status
      // lags behind, is not a receivable — it is bookkeeping noise that
      // would pad every bucket it landed in.
      .filter((row) => row.outstanding > 0)
  );
}
