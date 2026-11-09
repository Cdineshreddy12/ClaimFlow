import { config } from "dotenv";
config({ path: "../../.env" });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "./client.js";

/**
 * Checks the database says things that could all be true at once.
 *
 * Every rule here is one I broke and then found by hand: a claim
 * settled the day before it was admitted, deductions totalling more
 * than the bill they were cut from, a pre-auth form whose lines did
 * not add up to the total it declared, sixty-seven claims carrying an
 * empty checklist. Each was found by writing a query at the terminal
 * and reading the answer, which is a bad way to find out and a worse
 * way to find out twice.
 *
 *     pnpm --filter @claimflow/api db:verify
 *
 * Exits non-zero on the first failure, so it can gate a demo or a
 * deploy rather than only inform one.
 */

interface Check {
  name: string;
  /** Rows that should not exist. The check passes when there are none. */
  offenders: string;
}

const CHECKS: Check[] = [
  {
    name: "every settled claim's money adds up (billed − deducted = settled)",
    offenders: `
      select c.reference
      from claims c left join deductions d on d.claim_id = c.id
      where c.status = 'SETTLED'
      group by c.id
      having c.billed_amount - coalesce(sum(d.amount), 0) <> c.settled_amount`,
  },
  {
    name: "nothing is settled before it was admitted",
    offenders: `
      select reference from claims
      where status = 'SETTLED' and settled_on < created_at::date`,
  },
  {
    name: "only settled claims carry a settlement",
    offenders: `
      select reference from claims
      where settled_amount is not null and status <> 'SETTLED'`,
  },
  {
    name: "a deduction only sits on a claim that was actually paid",
    offenders: `
      select c.reference from deductions d
      join claims c on c.id = d.claim_id
      where c.status <> 'SETTLED'`,
  },
  {
    name: "every claim has a checklist",
    offenders: `
      select reference from claims
      where jsonb_array_length(checklist_snapshot) = 0`,
  },
  {
    name: "every claim has at least one status event",
    offenders: `
      select c.reference from claims c
      where not exists (
        select 1 from claim_status_events e where e.claim_id = c.id)`,
  },
  {
    // CLM-1655 was submitted tomorrow. The bill date was the approval
    // plus the length of stay with nothing capping it, so a claim
    // admitted recently enough got a bill dated past today — invisible
    // in every list, since they sort newest first and it simply sat on
    // top looking like the latest one.
    name: "nothing happened in the future",
    offenders: `
      select c.reference from claim_status_events e
      join claims c on c.id = e.claim_id
      where e.created_at > now()`,
  },
  {
    /*
      Turnaround counts a breach as `answered_at > sla_deadline`, so an
      event with no deadline can never be one. Both seeds wrote null,
      and the result was a compliance column reading 0% past target
      against a 1-hour window on 48-hour averages — the headline number
      of an IRDAI demo, green because the data was missing.
    */
    name: "every decision event carries the deadline it is judged against",
    offenders: `
      select c.reference from claim_status_events e
      join claims c on c.id = e.claim_id
      where e.status in ('PRE_AUTH_SENT', 'FINAL_BILL_SUBMITTED',
                         'ENHANCEMENT_REQUESTED')
        and e.sla_deadline is null`,
  },
  {
    /*
      Nobody pays for a discharge they never authorised. The state
      machine enforces the order going forward; this catches rows that
      predate it, which is how the turnaround report came to read a
      weeks-long wait for money as a three-hour discharge decision.
    */
    name: "a settled claim was discharged before it was paid",
    offenders: `
      select c.reference from claims c
      where c.status = 'SETTLED'
        and not exists (
          select 1 from claim_status_events e
          where e.claim_id = c.id and e.status = 'DISCHARGE_AUTHORISED')`,
  },
  {
    name: "a claim an insurer approved was not approved against a blank form",
    offenders: `
      select c.reference from claims c
      where c.status in ('APPROVED', 'FINAL_BILL_SUBMITTED', 'SETTLED')
        and not exists (
          select 1 from claim_preauth_fields f where f.claim_id = c.id)`,
  },
  {
    name: "a claim's status matches its latest event",
    offenders: `
      select c.reference from claims c
      join lateral (
        select status from claim_status_events e
        where e.claim_id = c.id order by e.created_at desc limit 1
      ) latest on true
      where latest.status <> c.status`,
  },
  {
    name: "pre-auth costing lines sum to the total they declare",
    offenders: `
      with f as (
        select claim_id,
          max(value) filter (where field_key = 'totalExpectedCost')::numeric as total,
          max(value) filter (where field_key = 'roomRentPerDay')::numeric as room,
          max(value) filter (where field_key = 'expectedStayDays')::numeric as stay,
          max(value) filter (where field_key = 'investigationCost')::numeric as inv,
          max(value) filter (where field_key = 'otCharges')::numeric as ot,
          max(value) filter (where field_key = 'professionalFees')::numeric as fees,
          max(value) filter (where field_key = 'medicinesConsumables')::numeric as meds
        from claim_preauth_fields group by claim_id)
      select c.reference from f join claims c on c.id = f.claim_id
      where f.total is not null
        and f.total <> (f.room * f.stay + f.inv + f.ot + f.fees + f.meds)`,
  },
  {
    name: "no payer or procedure left over from a test run",
    offenders: `
      select name from insurers where name ~ 'Test Insurer [0-9]{10,}'
      union all
      select name from procedures where name ~ 'Test (Procedure|Other Procedure)|[0-9]{10,}-'`,
  },
];

async function main(): Promise<void> {
  let failed = 0;

  for (const check of CHECKS) {
    const rows = (await db.execute(sql.raw(check.offenders))) as unknown as {
      reference?: string;
      name?: string;
    }[];
    if (rows.length === 0) {
      console.log(`  ok    ${check.name}`);
      continue;
    }
    failed++;
    const who = rows
      .slice(0, 6)
      .map((r) => r.reference ?? r.name)
      .join(", ");
    console.log(
      `  FAIL  ${check.name}\n          ${rows.length}: ${who}${rows.length > 6 ? " …" : ""}`,
    );
  }

  console.log(
    failed === 0
      ? `\n${CHECKS.length} checks passed.`
      : `\n${failed} of ${CHECKS.length} checks failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
