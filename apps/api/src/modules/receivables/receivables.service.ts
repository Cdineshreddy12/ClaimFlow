import type { Role } from "@claimflow/contracts";
import * as repo from "./receivables.repository.js";

/**
 * What the hospital is owed, and how long it has been owed for.
 *
 * The gap docs/adr/0011 and 0014 left: the product measured what gets
 * *cut* and how long insurers take to *decide*, and never what is
 * simply sitting unpaid. A CFO manages cash timing before either —
 * money approved and not yet arrived is the number that decides
 * whether this month's salaries are comfortable.
 *
 * Computed on read, never stored. An age is a comparison against now,
 * and a persisted "days outstanding" is wrong the moment it is
 * written — the same reasoning the checklist gap view and the SLA
 * clocks are built on.
 */

export interface AgeingBucket {
  key: "0_30" | "31_60" | "61_90" | "over_90";
  label: string;
  claims: number;
  total: number;
}

export interface InsurerOutstanding {
  insurerName: string;
  claims: number;
  total: number;
  /** Days outstanding on the oldest unpaid claim for this insurer. */
  oldestDays: number;
}

export interface AgeingReport {
  asOf: Date;
  total: number;
  claims: number;
  buckets: AgeingBucket[];
  byInsurer: InsurerOutstanding[];
  oldest: (repo.OutstandingClaimRow & { days: number })[];
}

interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * Thirty-day steps, and everything past ninety in one bucket.
 *
 * Not a tunable: the point of an ageing report is that it reads the
 * same as every other one a finance team has seen. A bespoke banding
 * would have to be re-explained to anyone it was shown to.
 */
const BUCKETS: { key: AgeingBucket["key"]; label: string; upTo: number }[] = [
  { key: "0_30", label: "0–30 days", upTo: 30 },
  { key: "31_60", label: "31–60 days", upTo: 60 },
  { key: "61_90", label: "61–90 days", upTo: 90 },
  { key: "over_90", label: "90+ days", upTo: Infinity },
];

const DAY_MS = 86_400_000;

export async function getAgeing(
  _auth: AuthContext,
  now = new Date(),
): Promise<AgeingReport> {
  const rows = await repo.listOutstanding(now);

  const aged = rows.map((row) => ({
    ...row,
    days: Math.max(
      0,
      Math.floor((now.getTime() - row.billedAt.getTime()) / DAY_MS),
    ),
  }));

  const buckets = BUCKETS.map((bucket, i) => {
    const from = i === 0 ? 0 : BUCKETS[i - 1]!.upTo + 1;
    const inBucket = aged.filter(
      (r) => r.days >= from && r.days <= bucket.upTo,
    );
    return {
      key: bucket.key,
      label: bucket.label,
      claims: inBucket.length,
      total: inBucket.reduce((sum, r) => sum + r.outstanding, 0),
    };
  });

  const byInsurerMap = new Map<string, InsurerOutstanding>();
  for (const row of aged) {
    const existing = byInsurerMap.get(row.insurerName) ?? {
      insurerName: row.insurerName,
      claims: 0,
      total: 0,
      oldestDays: 0,
    };
    existing.claims += 1;
    existing.total += row.outstanding;
    existing.oldestDays = Math.max(existing.oldestDays, row.days);
    byInsurerMap.set(row.insurerName, existing);
  }

  return {
    asOf: now,
    total: aged.reduce((sum, r) => sum + r.outstanding, 0),
    claims: aged.length,
    buckets,
    // Biggest exposure first — this list is read to decide who to
    // chase, and alphabetical order decides nothing.
    byInsurer: [...byInsurerMap.values()].sort((a, b) => b.total - a.total),
    // Oldest first, for the same reason. Capped: a chase list longer
    // than a morning is a list nobody works through.
    oldest: [...aged].sort((a, b) => b.days - a.days).slice(0, 20),
  };
}
