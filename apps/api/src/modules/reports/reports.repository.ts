import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";

export interface PeriodClaimsSummary {
  opened: number;
  settled: number;
  settledValue: number;
  /** Days from a claim's creation to its settlement date, averaged over claims settled in the window. Null when none settled. */
  avgTatDays: number | null;
}

/**
 * Claim volume and turnaround for one closed period — "how October went",
 * as opposed to the dashboard's open-ended "so far this month".
 */
export async function periodClaimsSummary(
  from: Date,
  to: Date,
): Promise<PeriodClaimsSummary> {
  const rows = await db.execute(sql`
    select
      count(*) filter (
        where created_at >= ${from.toISOString()}::timestamptz
          and created_at < ${to.toISOString()}::timestamptz
      )::int as opened,
      count(*) filter (
        where status = 'SETTLED'
          and settled_on >= ${from.toISOString()}::date
          and settled_on < ${to.toISOString()}::date
      )::int as settled,
      coalesce(sum(settled_amount) filter (
        where status = 'SETTLED'
          and settled_on >= ${from.toISOString()}::date
          and settled_on < ${to.toISOString()}::date
      ), 0) as settled_value,
      avg(extract(epoch from (settled_on::timestamptz - created_at)) / 86400) filter (
        where status = 'SETTLED'
          and settled_on >= ${from.toISOString()}::date
          and settled_on < ${to.toISOString()}::date
      ) as avg_tat_days
    from claims
  `);

  const row = (rows as unknown as Record<string, unknown>[])[0];

  return {
    opened: Number(row?.opened ?? 0),
    settled: Number(row?.settled ?? 0),
    settledValue: Number(row?.settled_value ?? 0),
    avgTatDays:
      row?.avg_tat_days != null ? Number(row.avg_tat_days as string) : null,
  };
}
