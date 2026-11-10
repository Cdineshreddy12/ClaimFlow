import { z } from "zod";
import { ClaimStatus, isTerminal, needsAttention } from "./status.js";

/**
 * How a desk asks for a page of claims.
 *
 * The filtering, sorting and searching used to happen in the browser
 * over every claim the API had ever returned. At three claims that is
 * invisible; at a hospital's two thousand a year it is the list, the
 * search and the dashboard all degrading together.
 *
 * These definitions live here rather than in the web app because the
 * SQL and the UI now have to agree about them — what "open" means,
 * where a status sits in the lifecycle, which fields a search looks
 * at. Two copies of that would drift the first time a status is added.
 */

export const ClaimSortKey = z.enum([
  "patient",
  "insurer",
  "status",
  "stageTime",
  "amount",
]);
export type ClaimSortKey = z.infer<typeof ClaimSortKey>;

export const SortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirection>;

/**
 * "open" and "attention" aren't statuses, they're the two questions a
 * desk actually asks: what's still live, and what's waiting on me.
 */
export const ClaimStatusFilter = z.union([
  ClaimStatus,
  z.enum(["all", "open", "attention"]),
]);
export type ClaimStatusFilter = z.infer<typeof ClaimStatusFilter>;

/**
 * The statuses a filter covers, or null for "every one".
 *
 * Derived from the state machine rather than listed, so a new status
 * is open or needs attention according to the same rules everything
 * else reads.
 */
export function statusesForFilter(
  filter: ClaimStatusFilter,
): ClaimStatus[] | null {
  if (filter === "all") return null;
  if (filter === "open") {
    return ClaimStatus.options.filter((s) => !isTerminal(s));
  }
  if (filter === "attention") {
    return ClaimStatus.options.filter((s) => needsAttention(s));
  }
  return [filter];
}

/**
 * Where a status sits in the lifecycle, so sorting by status reads as
 * progress rather than alphabetically.
 */
export const CLAIM_STATUS_ORDER: Record<ClaimStatus, number> = {
  DRAFT: 0,
  PRE_AUTH_SENT: 1,
  QUERY_RAISED: 2,
  ENHANCEMENT_REQUESTED: 3,
  APPROVED: 4,
  FINAL_BILL_SUBMITTED: 5,
  DISCHARGE_AUTHORISED: 6,
  SETTLED: 7,
  REJECTED: 8,
};

/** About a screen of the table. Capped so a caller can't ask for everything by accident. */
export const CLAIM_PAGE_SIZE = 25;
export const MAX_CLAIM_PAGE_SIZE = 200;

export const ClaimListQuery = z.object({
  /**
   * Patient, reference, insurer or procedure — the things a desk has
   * to hand off a TPA email. Never the uuid: nobody types one.
   */
  q: z.string().trim().max(120).optional(),
  statusFilter: ClaimStatusFilter.optional(),
  sort: ClaimSortKey.optional(),
  dir: SortDirection.optional(),
  limit: z.coerce.number().int().positive().max(MAX_CLAIM_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ClaimListQuery = z.infer<typeof ClaimListQuery>;

export interface ClaimPage<T> {
  rows: T[];
  /** Matching the filter, not on the page — what "of 312" is counted from. */
  total: number;
}
