import { isTerminal, needsAttention } from "@claimflow/contracts";
import type { ClaimStatus } from "@claimflow/contracts";
import type { Claim } from "./types";

/**
 * Filtering and sorting for the claims ledger, kept out of the
 * component so the behaviour a desk relies on can be tested without
 * rendering anything.
 */

export type ClaimSortKey =
  "patient" | "insurer" | "status" | "stageTime" | "amount";

export type SortDirection = "asc" | "desc";

/**
 * "open" and "attention" aren't statuses, they're the two questions a
 * desk actually asks: what's still live, and what's waiting on me.
 * Both come from the shared state machine rather than a list here.
 */
export type StatusFilter = ClaimStatus | "all" | "open" | "attention";

export interface ClaimListState {
  search: string;
  status: StatusFilter;
  sortKey: ClaimSortKey;
  direction: SortDirection;
}

export const DEFAULT_LIST_STATE: ClaimListState = {
  search: "",
  status: "open",
  sortKey: "stageTime",
  // Longest-waiting first: the top of the list should be the thing most
  // at risk, not the thing most recently touched.
  direction: "desc",
};

function matchesStatus(claim: Claim, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return !isTerminal(claim.status);
  if (filter === "attention") return needsAttention(claim.status);
  return claim.status === filter;
}

/**
 * Searches the things a desk actually has to hand: the patient's name,
 * the claim reference they read off a TPA email, the insurer, and the
 * procedure. Never the uuid — nobody types one, and it isn't shown.
 */
function matchesSearch(claim: Claim, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    claim.patientName.toLowerCase().includes(q) ||
    claim.insurerName.toLowerCase().includes(q) ||
    claim.procedureName.toLowerCase().includes(q) ||
    claim.reference.toLowerCase().includes(q)
  );
}

export function filterClaims(
  claims: Claim[],
  state: Pick<ClaimListState, "search" | "status">,
): Claim[] {
  return claims.filter(
    (claim) =>
      matchesStatus(claim, state.status) && matchesSearch(claim, state.search),
  );
}

/** Where a status sits in the lifecycle, so sorting by status reads as progress rather than alphabetically. */
const STATUS_ORDER: Record<ClaimStatus, number> = {
  DRAFT: 0,
  PRE_AUTH_SENT: 1,
  QUERY_RAISED: 2,
  ENHANCEMENT_REQUESTED: 3,
  APPROVED: 4,
  FINAL_BILL_SUBMITTED: 5,
  SETTLED: 6,
  REJECTED: 7,
};

function compare(a: Claim, b: Claim, key: ClaimSortKey): number {
  switch (key) {
    case "patient":
      return a.patientName.localeCompare(b.patientName);
    case "insurer":
      return a.insurerName.localeCompare(b.insurerName);
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "amount": {
      // A claim with no amount yet sorts last either way rather than
      // counting as zero, which would bury it under settled rupees.
      const left = a.billedAmount === null ? null : Number(a.billedAmount);
      const right = b.billedAmount === null ? null : Number(b.billedAmount);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    }
    case "stageTime":
      // Oldest updatedAt = longest in stage. Ascending by timestamp is
      // descending by waiting time, so this is inverted deliberately.
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }
}

export function sortClaims(
  claims: Claim[],
  key: ClaimSortKey,
  direction: SortDirection,
): Claim[] {
  const sorted = [...claims].sort((a, b) => compare(a, b, key));
  return direction === "asc" ? sorted : sorted.reverse();
}

export function applyClaimList(
  claims: Claim[],
  state: ClaimListState,
): Claim[] {
  return sortClaims(
    filterClaims(claims, state),
    state.sortKey,
    state.direction,
  );
}

/** Clicking the active column flips it; clicking a new one starts on that column's natural order. */
export function nextSort(
  state: ClaimListState,
  key: ClaimSortKey,
): ClaimListState {
  if (state.sortKey === key) {
    return {
      ...state,
      direction: state.direction === "asc" ? "desc" : "asc",
    };
  }
  // Names read best A–Z; times and amounts read best biggest-first.
  const natural: SortDirection =
    key === "patient" || key === "insurer" ? "asc" : "desc";
  return { ...state, sortKey: key, direction: natural };
}
