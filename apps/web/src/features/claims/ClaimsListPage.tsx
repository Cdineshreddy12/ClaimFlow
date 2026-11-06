import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "reicon-react";
import { ClaimStatus } from "@claimflow/contracts";
import { AppShell } from "../../app/AppShell";
import { Button } from "@/components/ui/button";
import { Loader } from "../../components/ui/loader";
import { formatAmount, formatDuration } from "../../lib/format";
import { useClaims } from "./api";
import {
  applyClaimList,
  DEFAULT_LIST_STATE,
  nextSort,
  type ClaimListState,
  type ClaimSortKey,
  type StatusFilter,
} from "./list";
import { STATUS_CHIP_VARIANT, STATUS_LABEL, type Claim } from "./types";
import { Badge } from "@/components/ui/badge";
import {
  SortButton,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableFooterBar,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The claim ledger.
 *
 * Split out of the dashboard because they answer different questions: a
 * dashboard says what needs doing today, this says where any given
 * claim is. Nine people sharing a desk need to find one patient among
 * hundreds, which is search and sort, not a summary card.
 */

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "All" },
  ...ClaimStatus.options.map((status) => ({
    value: status as StatusFilter,
    label: STATUS_LABEL[status],
  })),
];

const COLUMNS: { key: ClaimSortKey; label: string; numeric?: boolean }[] = [
  { key: "patient", label: "Patient" },
  { key: "insurer", label: "Insurer / TPA" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "stageTime", label: "Time in stage", numeric: true },
];

function stageTimeClass(claim: Claim): string {
  if (claim.status === "QUERY_RAISED") return "font-semibold text-critical";
  if (
    claim.status === "PRE_AUTH_SENT" ||
    claim.status === "ENHANCEMENT_REQUESTED"
  )
    return "font-semibold text-pending";
  return "";
}

export function ClaimsListPage() {
  const { data: claims, isLoading, isError } = useClaims();
  const [state, setState] = useState<ClaimListState>(DEFAULT_LIST_STATE);

  // Stamped once per mount so the "time in stage" column doesn't tick
  // while someone is reading it.
  const now = useMemo(() => Date.now(), []);

  const visible = useMemo(
    () => applyClaimList(claims ?? [], state),
    [claims, state],
  );

  const total = claims?.length ?? 0;

  return (
    <AppShell title="Claims" subtitle="Every claim on the desk">
      <div className="mb-[18px] flex flex-col flex-wrap items-stretch gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex min-w-0 flex-1 items-center text-ink-faint sm:flex-[1_1_260px] [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-[11px] [&_svg]:size-[15px]">
          <Search aria-hidden focusable="false" />
          <input
            type="search"
            className="w-full min-w-0 rounded-md border border-line bg-surface-sunken py-2 pl-[34px] pr-3 font-[inherit] text-base text-ink placeholder:text-ink-faint hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            placeholder="Search patient, insurer, procedure or claim id…"
            aria-label="Search claims"
            value={state.search}
            onChange={(e) => setState({ ...state, search: e.target.value })}
          />
        </div>
        <select
          className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 font-[inherit] text-base text-ink hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:w-auto"
          aria-label="Filter by status"
          value={state.status}
          onChange={(e) =>
            setState({ ...state, status: e.target.value as StatusFilter })
          }
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Button asChild>
          <Link to="/claims/new">Open a claim</Link>
        </Button>
      </div>

      {isLoading ? <Loader label="Loading claims…" /> : null}
      {isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn&apos;t load the claims.
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <TableCard>
          {total === 0 ? (
            <p className="px-1 py-2.5 text-base text-ink-faint">
              No claims yet. Open one to start a cashless file — the insurer and
              procedure decide which checklist applies.
            </p>
          ) : visible.length === 0 ? (
            // Different from having no claims at all, and the fix is
            // different too, so it says so rather than reusing "empty".
            <p className="px-1 py-2.5 text-base text-ink-faint">
              Nothing matches that.{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold text-accent-ink underline"
                onClick={() => setState(DEFAULT_LIST_STATE)}
              >
                Clear the filters
              </button>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  {COLUMNS.map((col) => {
                    const active = state.sortKey === col.key;
                    return (
                      <TableHead
                        key={col.key}
                        aria-sort={
                          active
                            ? state.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <SortButton
                          direction={active ? state.direction : null}
                          onClick={() => setState(nextSort(state, col.key))}
                        >
                          {col.label}
                        </SortButton>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((claim) => (
                  /*
                    The whole row opens the claim.

                    It highlighted on hover and then only the reference
                    navigated — so clicking a patient's name, which is
                    the thing a desk actually reads the row for, did
                    nothing. The hover state was promising a click the
                    row did not honour.

                    The link stays: it is what gives the row a keyboard
                    stop and what lets a desk middle-click a claim into
                    a new tab, neither of which an onClick provides.
                  */
                  <TableRow
                    key={claim.id}
                    onClick={() => navigate(`/claims/${claim.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono tabular-nums">
                      <Link
                        to={`/claims/${claim.id}`}
                        className="font-semibold text-accent-ink no-underline hover:underline"
                      >
                        {claim.reference}
                      </Link>
                    </TableCell>
                    <TableCell className="flex flex-col [&_.proc]:text-sm [&_.proc]:text-ink-faint">
                      {claim.patientName}
                      <span className="proc">{claim.procedureName}</span>
                    </TableCell>
                    <TableCell>{claim.insurerName}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_CHIP_VARIANT[claim.status]}>
                        {STATUS_LABEL[claim.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatAmount(claim.billedAmount)}
                    </TableCell>
                    <TableCell
                      className={`font-mono tabular-nums ${stageTimeClass(claim)}`}
                    >
                      {formatDuration(
                        now - new Date(claim.updatedAt).getTime(),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCard>
      ) : null}

      {!isLoading && !isError && total > 0 ? (
        <TableFooterBar>
          <span>Total rows: {total}</span>
          <span>
            {visible.length === total
              ? "No filters applied"
              : `Showing ${visible.length} of ${total}`}
          </span>
        </TableFooterBar>
      ) : null}
    </AppShell>
  );
}
