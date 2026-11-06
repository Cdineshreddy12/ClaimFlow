import type {
  ClaimSortKey,
  ClaimStatusFilter,
  SortDirection,
} from "@claimflow/contracts";

/**
 * What the claims ledger is currently showing.
 *
 * The filtering, searching and ordering themselves moved into SQL —
 * see @claimflow/contracts/claims/claim-list, which both the query and
 * this screen read, so "open" and the lifecycle sort order have one
 * definition rather than two that drift.
 *
 * What is left here is the screen's own state and the one rule the
 * server has no opinion about: what clicking a column header does.
 */

export type { ClaimSortKey, SortDirection };
export type StatusFilter = ClaimStatusFilter;

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

/** Each column's natural first click — the order someone means when they pick it. */
const NATURAL_DIRECTION: Record<ClaimSortKey, SortDirection> = {
  patient: "asc",
  insurer: "asc",
  status: "asc",
  amount: "desc",
  stageTime: "desc",
};

/** Clicking the active column flips it; clicking a new one starts on that column's natural order. */
export function nextSort(
  state: ClaimListState,
  key: ClaimSortKey,
): ClaimListState {
  if (state.sortKey !== key) {
    return { ...state, sortKey: key, direction: NATURAL_DIRECTION[key] };
  }
  return {
    ...state,
    sortKey: key,
    direction: state.direction === "asc" ? "desc" : "asc",
  };
}
