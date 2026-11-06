import type { ClaimStatus } from "./status.js";

/**
 * Everything the dashboard shows, counted in the database.
 *
 * The dashboard used to fetch every claim the hospital had ever opened
 * and compute all of this in the browser — five passes over one array
 * for the KPI row, the donut, the six-month trend and the attention
 * list. At three claims that is free. At a hospital's two thousand a
 * year it is two thousand rows over the wire to render six numbers,
 * on the screen a desk opens first every morning.
 *
 * One request, counted where the rows already are. The scoping rule is
 * unchanged: a desk executive's dashboard counts their own claims
 * (docs/adr/0002).
 */

export interface StatusCount {
  status: ClaimStatus;
  count: number;
}

export interface SettledMonth {
  /** Full year, and a 0-based month to match JS `Date`. */
  year: number;
  month: number;
  count: number;
  /** What the insurers actually paid, in rupees. */
  value: number;
}

/** A claim waiting on the desk, as the attention list shows it. */
export interface WaitingClaim {
  id: string;
  reference: string;
  patientName: string;
  procedureName: string;
  insurerName: string;
  status: ClaimStatus;
  updatedAt: string;
}

export interface ClaimOverview {
  openClaims: number;
  needsAttention: number;
  /**
   * Hours since their last status change, averaged over open claims —
   * a computable stand-in for the brief's discharge-wait metric, which
   * would need event tracking this schema doesn't have.
   */
  avgTimeInStageHours: number | null;
  /**
   * Counted on the payment date, not the status change: a claim marked
   * settled in October whose money landed in November belongs to
   * November, which is the month the desk gets credit for.
   */
  settledThisMonth: { count: number; value: number };
  byStatus: StatusCount[];
  /** Trailing six calendar months, oldest first, including this one. */
  settledTrend: SettledMonth[];
  /** The longest-waiting claims needing a human, not all of them. */
  waiting: WaitingClaim[];
}

/** How many claims the attention list shows before it stops being a list. */
export const OVERVIEW_WAITING_LIMIT = 8;

/** Trailing six calendar months, oldest first, including the current one. */
export function trailingMonths(now: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return months;
}
