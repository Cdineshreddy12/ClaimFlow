import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../../app/AppShell";
import { Button } from "@/components/ui/button";
import { Loader } from "../../components/ui/loader";
import { useClaimOverview } from "../claims/api";
import { useQueryInbox } from "../queries/api";
import { useDeductionsSummary } from "../deductions/api";
import { DeductionsByReasonCard } from "./DeductionsByReasonCard";
import { NeedsAttentionCard } from "./NeedsAttentionCard";
import { SlaWatchCard } from "../sla/SlaWatchCard";
import { KpiRow } from "./KpiRow";
import { ClaimsByStatusDonut } from "./ClaimsByStatusDonut";
import { SettledTrendChart } from "./SettledTrendChart";
import { dashboardMetrics } from "./metrics";

export function DashboardPage() {
  // One request for the whole page. It used to be every claim the
  // hospital had ever opened, looped over five times in the browser.
  const {
    data: overview,
    isLoading: claimsLoading,
    isError: claimsError,
  } = useClaimOverview();
  const {
    data: openQueries,
    isLoading: queriesLoading,
    isError: queriesError,
  } = useQueryInbox("open");
  const { data: deductions } = useDeductionsSummary();

  // Stamped once per mount rather than re-read on every render — keeps the
  // "time in stage" figures stable while the page sits open.
  const now = useMemo(() => Date.now(), []);

  // The claim side is counted server-side; the query side still comes
  // from the inbox, which is bounded by the open queries a desk has.
  const metrics = useMemo(
    () => dashboardMetrics(overview, openQueries ?? [], now),
    [overview, openQueries, now],
  );

  const isLoading = claimsLoading || queriesLoading;
  const isError = claimsError || queriesError;

  return (
    <AppShell title="Dashboard" subtitle="Across the cashless desk">
      {isLoading ? <Loader label="Loading the desk…" /> : null}
      {isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn't load the dashboard.
        </div>
      ) : null}

      <div className="mb-6 flex justify-end">
        <Button asChild>
          <Link to="/claims/new">Open a claim</Link>
        </Button>
      </div>

      {!isLoading && !isError ? (
        <>
          <KpiRow metrics={metrics} deductions={deductions} />
          {/* Clocks first: everything else on this page is a count of
              work, and this is the only card that says what is late. */}
          <SlaWatchCard />
          {/* Its own row, full width — a five-column table of waiting
              claims needed the room more than it needed to sit next to
              the clock card. */}
          <div className="mt-5">
            <NeedsAttentionCard waiting={overview?.waiting ?? []} now={now} />
          </div>
          {/* Ratio lives in CSS, not an inline style — an inline
              grid-template-columns outranks every media query, which is
              exactly how this silently stayed 2-up on a phone. */}
          <div className="mt-5 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2 [&+&]:mt-5 [&>*]:min-w-0 lg:!grid-cols-[1fr_1.5fr]">
            <ClaimsByStatusDonut byStatus={overview?.byStatus ?? []} />
            <DeductionsByReasonCard summary={deductions} />
          </div>
          <SettledTrendChart months={overview?.settledTrend ?? []} />
        </>
      ) : null}
    </AppShell>
  );
}
